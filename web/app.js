(function () {
  'use strict';

  const state = {
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
  };

  const BADGE_COLORS = [
    '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
    '#3498db', '#9b59b6', '#e84393', '#fd79a8', '#00cec9',
    '#6c5ce7', '#fdcb6e', '#55a3e8', '#ff7675', '#a29bfe',
    '#fab1a0', '#74b9ff', '#81ecec', '#dfe6e9', '#b2bec3',
  ];

  function hashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
  }

  let dragStart = { x: 0, y: 0 };
  let touchPanStart = null;
  let pinchStart = null;
  let searchTimeout = null;
  const recentStrips = [];
  const MAX_RECENT = 20;

  const LS_SELECTED = 'panels_selected';
  const LS_THEME = 'panels_theme';
  const LS_SIDEBAR = 'panels_sidebar_collapsed';
  const LS_COLLAPSIBLES = 'panels_collapsibles';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const mobileQuery = window.matchMedia('(max-width: 768px)');

  function sidebarArrow(collapsed) {
    return collapsed
      ? '<i class="fa-solid fa-chevron-left"></i>'
      : '<i class="fa-solid fa-chevron-right"></i>';
  }

  const els = {
    selectedCount: $('#selectedCount'),
    themeToggle: $('#themeToggle'),
    comicPanel: $('#comicPanel'),
    comicEmpty: $('#comicEmpty'),
    comicLoading: $('#comicLoading'),
    comicDisplay: $('#comicDisplay'),
    comicMeta: $('#comicMeta'),
    comicImageWrap: $('.comic-image-wrap'),
    comicImage: $('#comicImage'),
    comicZoomBar: $('#comicZoomBar'),
    comicNavBar: $('#comicNavBar'),
    btnToday: $('#btnToday'),
    btnNextPanel: $('#btnNextPanel'),
    zoomOutBtn: $('#zoomOutBtn'),
    zoomInBtn: $('#zoomInBtn'),
    zoomResetBtn: $('#zoomResetBtn'),
    zoomSlider: $('#zoomSlider'),
    zoomLevel: $('#zoomLevel'),
    sidebarToggle: $('#sidebarToggle'),
    selectionPanel: $('#selectionPanel'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    tagFilters: $('#tagFilters'),
    alphaBar: $('#alphaBar'),
    recommendToggle: $('#recommendToggle'),
    luckyBtn: $('#luckyBtn'),
    badgeGrid: $('#badgeGrid'),
  };

  async function fetchComics() {
    const res = await fetch('/api/comics');
    if (!res.ok) throw new Error('Failed to fetch comics');
    return res.json();
  }

  async function fetchStrip(endpoint, date) {
    const res = await fetch(`/api/comics/${encodeURIComponent(endpoint)}/${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error('Failed to fetch strip');
    return res.json();
  }

  async function fetchRecommendations(endpoints, limit) {
    const selected = Array.from(endpoints).join(',');
    const res = await fetch(`/api/recommendations?selected=${encodeURIComponent(selected)}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch recommendations');
    return res.json();
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(LS_SELECTED);
      if (saved) {
        const arr = JSON.parse(saved);
        arr.forEach((ep) => state.selectedEndpoints.add(ep));
      }
    } catch (e) {} 

    const theme = localStorage.getItem(LS_THEME);
    if (theme) document.documentElement.setAttribute('data-theme', theme);

    const savedSidebar = localStorage.getItem(LS_SIDEBAR);
    const collapsed = savedSidebar === null ? mobileQuery.matches : savedSidebar === 'true';
    els.selectionPanel.classList.toggle('collapsed', collapsed);
    els.sidebarToggle.classList.toggle('collapsed', collapsed);
    els.sidebarToggle.innerHTML = sidebarArrow(collapsed);
  }

  function saveSelected() {
    localStorage.setItem(LS_SELECTED, JSON.stringify(Array.from(state.selectedEndpoints)));
  }

  function saveTheme(theme) {
    localStorage.setItem(LS_THEME, theme);
  }

  function saveSidebar(collapsed) {
    localStorage.setItem(LS_SIDEBAR, String(collapsed));
  }

  function initTheme() {
    updateThemeButton();
    els.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      saveTheme(next);
      updateThemeButton();
    });
  }

  function updateThemeButton() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    els.themeToggle.innerHTML = theme === 'dark'
      ? '<i class="fa-solid fa-moon"></i>'
      : '<i class="fa-solid fa-sun"></i>';
  }

  function initSidebar() {
    const applySidebarState = (isCollapsed, persist) => {
      els.selectionPanel.classList.toggle('collapsed', isCollapsed);
      els.sidebarToggle.classList.toggle('collapsed', isCollapsed);
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
      els.sidebarToggle.innerHTML = sidebarArrow(isCollapsed);
    });

    document.addEventListener('pointerdown', (e) => {
      if (!mobileQuery.matches) return;
      if (els.selectionPanel.classList.contains('collapsed')) return;
      if (els.selectionPanel.contains(e.target) || els.sidebarToggle.contains(e.target)) return;
      applySidebarState(true, true);
    });
  }

  function initCollapsibles() {
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

  function buildTagFilters() {
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

  function buildAlphaBar() {
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

  function initSearch() {
    els.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = els.searchInput.value.trim().toLowerCase();
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

  function initRecommend() {
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

  async function refreshRecommendations() {
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

  function getBaseFilteredComics() {
    return state.allComics.filter((c) => {
      if (state.activeTags.size > 0 && !c.tags.some((t) => state.activeTags.has(t))) return false;
      if (state.activeLetter === '#' && !/^\d/.test(c.title)) return false;
      if (state.activeLetter && state.activeLetter !== '#' && !c.title.toUpperCase().startsWith(state.activeLetter)) return false;
      return true;
    });
  }

  function matchesSearch(c) {
    if (!state.searchQuery) return true;
    return c.title.toLowerCase().includes(state.searchQuery) || c.endpoint.toLowerCase().includes(state.searchQuery);
  }

  function renderBadgeGrid() {
    const filtered = getBaseFilteredComics();
    const selectedComics = filtered.filter((c) => state.selectedEndpoints.has(c.endpoint));
    const recEndpoints = new Set(state.recommendations.map((r) => r.endpoint));
    const recommendedComics = state.recommendEnabled
      ? filtered.filter((c) => recEndpoints.has(c.endpoint) && !state.selectedEndpoints.has(c.endpoint))
      : [];
    const selectedSet = new Set([...state.selectedEndpoints, ...recEndpoints]);
    const allComics = filtered.filter((c) => !selectedSet.has(c.endpoint) && matchesSearch(c));

    els.badgeGrid.innerHTML = '';

    if (selectedComics.length > 0) {
      appendSection(`[ selected: ${selectedComics.length} ]`, selectedComics, 'selected', true);
    }

    if (recommendedComics.length > 0) {
      appendSection('[ recommended ]', recommendedComics, 'recommended');
    }

    if (allComics.length > 0) {
      appendSection(`[ all comics: ${allComics.length} ]`, allComics, '');
    }

    updateSelectedCount();
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
      badge.addEventListener('click', () => toggleSelection(comic.endpoint));
      grid.appendChild(badge);
    });
    els.badgeGrid.appendChild(grid);
  }

  function toggleSelection(endpoint) {
    if (state.selectedEndpoints.has(endpoint)) {
      state.selectedEndpoints.delete(endpoint);
    } else {
      state.selectedEndpoints.add(endpoint);
    }
    saveSelected();
    renderBadgeGrid();
    updateNavVisibility();
    if (state.recommendEnabled) refreshRecommendations();
  }

  function updateSelectedCount() {
    const count = state.selectedEndpoints.size;
    els.selectedCount.textContent = `[ ${count} selected ]`;
  }

  function showComic(strip) {
    state.currentStrip = strip;
    els.comicEmpty.classList.add('hidden');
    els.comicLoading.classList.add('hidden');
    els.comicDisplay.classList.remove('hidden');
    els.comicNavBar.classList.remove('hidden');

    const comic = state.allComics.find((c) => c.endpoint === strip.endpoint);
    const author = comic && comic.author ? ` by ${comic.author}` : '';
    els.comicMeta.textContent = `[ ${strip.title} ]${author} — ${strip.date}`;
    els.comicImage.src = `/api/comics/${encodeURIComponent(strip.endpoint)}/${encodeURIComponent(strip.date)}/image`;
    resetZoom();

    updateNavVisibility();
  }

  function showEmpty() {
    state.currentStrip = null;
    els.comicEmpty.classList.remove('hidden');
    els.comicLoading.classList.add('hidden');
    els.comicDisplay.classList.add('hidden');
    els.comicNavBar.classList.add('hidden');
    resetZoom();
  }

  function showLoading() {
    state.isLoading = true;
    els.comicEmpty.classList.add('hidden');
    els.comicLoading.classList.remove('hidden');
    els.comicDisplay.classList.add('hidden');
    els.comicNavBar.classList.add('hidden');
    resetZoom();
  }

  function showError() {
    els.comicLoading.classList.add('hidden');
    els.comicEmpty.classList.remove('hidden');
    els.comicEmpty.querySelector('span').textContent = '[ strip not found — try again ]';
    els.comicDisplay.classList.add('hidden');
    resetZoom();
    updateNavVisibility();
  }

  function updateNavVisibility() {
    const count = state.selectedEndpoints.size;
    if (count === 0) {
      els.comicNavBar.classList.add('hidden');
      return;
    }
    els.comicNavBar.classList.remove('hidden');

    if (count === 1) {
      els.btnToday.classList.remove('hidden');
    } else {
      els.btnToday.classList.add('hidden');
    }
  }

  function stripKey(strip) {
    return `${strip.endpoint}:${strip.date}`;
  }

  function trackStrip(strip) {
    const key = stripKey(strip);
    recentStrips.push(key);
    if (recentStrips.length > MAX_RECENT) recentStrips.shift();
  }

  async function nextPanel() {
    if (state.selectedEndpoints.size === 0 || state.isLoading) return;
    const endpoints = Array.from(state.selectedEndpoints);
    showLoading();

    for (let attempt = 0; attempt < 3; attempt++) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      try {
        const strip = await fetchStrip(endpoint, 'random');
        if (attempt < 2 && recentStrips.includes(stripKey(strip))) {
          continue;
        }
        trackStrip(strip);
        showComic(strip);
        state.isLoading = false;
        return;
      } catch (e) {
        if (attempt === 2) showError();
      }
    }
    state.isLoading = false;
  }

  async function todayPanel() {
    if (state.selectedEndpoints.size !== 1 || state.isLoading) return;
    const endpoint = Array.from(state.selectedEndpoints)[0];
    showLoading();
    try {
      const strip = await fetchStrip(endpoint, 'latest');
      showComic(strip);
    } catch (e) {
      showError();
    }
    state.isLoading = false;
  }

  function initNav() {
    els.btnNextPanel.addEventListener('click', nextPanel);
    els.btnToday.addEventListener('click', todayPanel);
  }

  function clampScale(s) {
    return Math.min(5, Math.max(1, s));
  }

  function getTouchDistance(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  function getTouchCenter(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  function applyScale(nextScale) {
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

  function resetZoom() {
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

  function initZoom() {
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
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStart = {
          distance: getTouchDistance(t1, t2),
          scale: state.zoom.scale,
          center: getTouchCenter(t1, t2),
          offset: { ...state.zoom.offset },
        };
        touchPanStart = null;
        return;
      }
      if (e.touches.length === 1 && state.zoom.scale > 1) {
        e.preventDefault();
        touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
      } else if (e.touches.length === 1 && state.zoom.scale > 1) {
        touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target === els.searchInput) return;

      if (state.currentStrip && (e.key === '+' || e.key === '=')) { applyScale(state.zoom.scale + 0.2); e.preventDefault(); return; }
      if (state.currentStrip && e.key === '-') { applyScale(state.zoom.scale - 0.2); e.preventDefault(); return; }
      if (state.currentStrip && (e.key === '0' || e.key === 'Escape')) { resetZoom(); e.preventDefault(); return; }
      if (e.key === ' ' || e.key === 'ArrowRight') { nextPanel(); e.preventDefault(); }
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function clearSelection() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0) {
      sel.removeAllRanges();
    }
  }

  async function init() {
    loadState();
    initTheme();
    initSidebar();
    initCollapsibles();
    initSearch();
    initRecommend();
    initNav();
    initZoom();
    initKeyboard();

    try {
      state.allComics = await fetchComics();
      buildTagFilters();
      buildAlphaBar();
      renderBadgeGrid();

      if (state.selectedEndpoints.size > 0) {
        updateNavVisibility();
        if (state.recommendEnabled) refreshRecommendations();
      }
    } catch (e) {
      els.badgeGrid.innerHTML = '<div class="badge-section-header">[ error loading comics ]</div>';
    }
  }

  init();
})();
