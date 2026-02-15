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
    currentView: 'panel',
    feed: {
      strips: [],
      seenKeys: new Set(),
      isLoadingBatch: false,
      lastSelectedSnapshot: null,
    },
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

  const feedZoom = { scale: 1, offset: { x: 0, y: 0 }, dragging: false };
  let feedDragStart = { x: 0, y: 0 };
  let feedTouchPanStart = null;
  let feedPinchStart = null;
  const recentStrips = [];
  const MAX_RECENT = 20;

  const LS_SELECTED = 'panels_selected';
  const LS_THEME = 'panels_theme';
  const LS_SIDEBAR = 'panels_sidebar_collapsed';
  const LS_COLLAPSIBLES = 'panels_collapsibles';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const mobileQuery = window.matchMedia('(max-width: 900px), (hover: none) and (pointer: coarse)');

  function sidebarArrow(collapsed) {
    return collapsed
      ? '<i class="fa-solid fa-chevron-left"></i>'
      : '<i class="fa-solid fa-chevron-right"></i>';
  }

  const els = {
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
    feedContainer: $('#feedContainer'),
    feedScroll: $('#feedScroll'),
    feedSentinel: $('#feedSentinel'),
    feedEmpty: $('#feedEmpty'),
    navFeedLink: $('#navFeedLink'),
    logoLink: $('#logoLink'),
    feedZoomOverlay: $('#feedZoomOverlay'),
    feedZoomBackdrop: $('#feedZoomBackdrop'),
    feedZoomClose: $('#feedZoomClose'),
    feedZoomWrap: $('#feedZoomWrap'),
    feedZoomImage: $('#feedZoomImage'),
    feedZoomOut: $('#feedZoomOut'),
    feedZoomIn: $('#feedZoomIn'),
    feedZoomReset: $('#feedZoomReset'),
    feedZoomSlider: $('#feedZoomSlider'),
    feedZoomLevel: $('#feedZoomLevel'),
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
    document.body.classList.toggle('drawer-open', mobileQuery.matches && !collapsed);
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

  function matchesTagAndAlphabet(c) {
    if (state.activeTags.size > 0 && !c.tags.some((t) => state.activeTags.has(t))) return false;
    if (state.activeLetter === '#' && !/^\d/.test(c.title)) return false;
    if (state.activeLetter && state.activeLetter !== '#' && !c.title.toUpperCase().startsWith(state.activeLetter)) return false;
    return true;
  }

  function matchesSearch(c) {
    if (!state.searchQuery) return true;
    return c.title.toLowerCase().includes(state.searchQuery) || c.endpoint.toLowerCase().includes(state.searchQuery);
  }

  function renderBadgeGrid() {
    const selectedComics = state.allComics.filter((c) => state.selectedEndpoints.has(c.endpoint));
    const recEndpoints = new Set(state.recommendations.map((r) => r.endpoint));
    const recommendedComics = state.recommendEnabled
      ? state.allComics.filter((c) => recEndpoints.has(c.endpoint) && !state.selectedEndpoints.has(c.endpoint))
      : [];
    const selectedSet = new Set([...state.selectedEndpoints, ...recEndpoints]);
    const allComics = state.allComics.filter((c) => !selectedSet.has(c.endpoint) && matchesTagAndAlphabet(c) && matchesSearch(c));

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
    if (state.currentView === 'feed') {
      clearFeed();
      state.feed.lastSelectedSnapshot = Array.from(state.selectedEndpoints).sort().join(',');
      if (state.selectedEndpoints.size > 0) {
        loadFeedBatch();
      } else {
        els.feedEmpty.classList.remove('hidden');
      }
    }
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

  function navigateTo(path) {
    if (location.pathname !== path) {
      history.pushState(null, '', path);
    }
    handleRoute();
  }

  function initRouter() {
    window.addEventListener('popstate', handleRoute);

    els.navFeedLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('/feed');
    });

    els.logoLink.addEventListener('click', () => {
      navigateTo('/');
    });

    handleRoute();
  }

  function handleRoute() {
    if (location.pathname === '/feed') {
      switchToFeed();
    } else {
      switchToPanel();
    }
  }

  function switchToFeed() {
    state.currentView = 'feed';
    document.body.classList.add('view-feed');
    document.body.classList.remove('view-panel');
    els.feedContainer.classList.remove('hidden');
    els.navFeedLink.classList.add('active');

    const snapshot = Array.from(state.selectedEndpoints).sort().join(',');
    if (state.feed.lastSelectedSnapshot !== snapshot) {
      clearFeed();
      state.feed.lastSelectedSnapshot = snapshot;
    }

    if (state.selectedEndpoints.size === 0) {
      els.feedEmpty.classList.remove('hidden');
    } else if (state.feed.strips.length === 0 && !state.feed.isLoadingBatch) {
      els.feedEmpty.classList.add('hidden');
      loadFeedBatch();
    }
  }

  function switchToPanel() {
    state.currentView = 'panel';
    document.body.classList.remove('view-feed');
    document.body.classList.add('view-panel');
    els.navFeedLink.classList.remove('active');
  }

  function createSkeletonCard() {
    const card = document.createElement('article');
    card.className = 'feed-card feed-card-skeleton';
    card.innerHTML =
      '<div class="feed-card-header">' +
        '<div class="feed-card-badge skeleton-pulse"></div>' +
        '<div class="feed-card-info">' +
          '<div class="skeleton-pulse" style="width:120px;height:14px;"></div>' +
          '<div class="skeleton-pulse" style="width:80px;height:11px;margin-top:4px;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="feed-card-image skeleton-pulse"></div>';
    return card;
  }

  function renderFeedCard(strip, comic) {
    const card = document.createElement('article');
    card.className = 'feed-card';

    const author = comic && comic.author ? comic.author : '';
    const authorHtml = author ? '<span class="feed-card-sub">by ' + escapeHtml(author) + ' &mdash; ' + escapeHtml(strip.date) + '</span>' : '<span class="feed-card-sub">' + escapeHtml(strip.date) + '</span>';
    const color = hashColor(strip.endpoint);

    card.innerHTML =
      '<div class="feed-card-header">' +
        '<div class="feed-card-badge">' +
          '<div class="badge-circle-bg" style="background:' + color + ';"></div>' +
          '<img src="/api/badges/' + encodeURIComponent(strip.endpoint) + '.png" alt="" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div class="feed-card-info">' +
          '<span class="feed-card-title">' + escapeHtml(strip.title) + '</span>' +
          authorHtml +
        '</div>' +
      '</div>' +
      '<div class="feed-card-image">' +
        '<img src="/api/comics/' + encodeURIComponent(strip.endpoint) + '/' + encodeURIComponent(strip.date) + '/image" alt="' + escapeHtml(strip.title) + '" loading="lazy">' +
      '</div>';

    const cardImg = card.querySelector('.feed-card-image img');
    if (cardImg) {
      cardImg.addEventListener('click', () => openFeedZoom(cardImg.src));
    }

    return card;
  }

  async function fetchRandomFeedStrip() {
    const endpoints = Array.from(state.selectedEndpoints);
    if (endpoints.length === 0) return null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      try {
        const strip = await fetchStrip(endpoint, 'random');
        const key = stripKey(strip);
        if (attempt < 2 && state.feed.seenKeys.has(key)) continue;
        state.feed.seenKeys.add(key);
        return strip;
      } catch (e) {
        if (attempt === 2) return null;
      }
    }
    return null;
  }

  async function loadFeedBatch() {
    if (state.feed.isLoadingBatch || state.selectedEndpoints.size === 0) return;
    state.feed.isLoadingBatch = true;

    const skeletons = [];
    for (let i = 0; i < 6; i++) {
      const skel = createSkeletonCard();
      els.feedScroll.appendChild(skel);
      skeletons.push(skel);
    }

    const promises = [];
    for (let i = 0; i < 6; i++) {
      promises.push(fetchRandomFeedStrip());
    }
    const results = await Promise.allSettled(promises);

    let loaded = 0;
    results.forEach((result, i) => {
      const strip = result.status === 'fulfilled' ? result.value : null;
      if (strip) {
        const comic = state.allComics.find((c) => c.endpoint === strip.endpoint);
        const card = renderFeedCard(strip, comic);
        skeletons[i].replaceWith(card);
        state.feed.strips.push(strip);
        loaded++;
      } else {
        skeletons[i].remove();
      }
    });

    if (state.feed.strips.length === 0) {
      els.feedEmpty.classList.remove('hidden');
    }

    state.feed.isLoadingBatch = false;
  }

  function clearFeed() {
    state.feed.strips = [];
    state.feed.seenKeys = new Set();
    state.feed.isLoadingBatch = false;
    els.feedScroll.innerHTML = '';
    els.feedEmpty.classList.add('hidden');
  }

  function initFeedScroll() {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.currentView === 'feed') {
        loadFeedBatch();
      }
    }, { root: els.feedContainer, rootMargin: '400px' });
    observer.observe(els.feedSentinel);
  }

  function openFeedZoom(imgSrc) {
    els.feedZoomImage.src = imgSrc;
    els.feedZoomOverlay.classList.remove('hidden');
    feedZoomResetState();
  }

  function closeFeedZoom() {
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

  function initFeedZoom() {
    const wrap = els.feedZoomWrap;

    els.feedZoomClose.addEventListener('click', closeFeedZoom);
    els.feedZoomBackdrop.addEventListener('click', closeFeedZoom);

    $('.feed-zoom-content').addEventListener('click', (e) => {
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

    ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
      wrap.addEventListener(eventName, (e) => e.preventDefault(), { passive: false });
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target === els.searchInput) return;

      if (e.key === 'Escape' && !els.feedZoomOverlay.classList.contains('hidden')) {
        closeFeedZoom();
        e.preventDefault();
        return;
      }

      if (state.currentStrip && (e.key === '+' || e.key === '=')) { applyScale(state.zoom.scale + 0.2); e.preventDefault(); return; }
      if (state.currentStrip && e.key === '-') { applyScale(state.zoom.scale - 0.2); e.preventDefault(); return; }
      if (state.currentStrip && (e.key === '0' || e.key === 'Escape')) { resetZoom(); e.preventDefault(); return; }
      if ((e.key === ' ' || e.key === 'ArrowRight') && state.currentView === 'panel') { nextPanel(); e.preventDefault(); }
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
    initFeedScroll();
    initFeedZoom();

    try {
      state.allComics = await fetchComics();
      buildTagFilters();
      buildAlphaBar();
      renderBadgeGrid();

      if (state.selectedEndpoints.size > 0) {
        updateNavVisibility();
        if (state.recommendEnabled) refreshRecommendations();
      }

      initRouter();
    } catch (e) {
      els.badgeGrid.innerHTML = '<div class="badge-section-header">[ error loading comics ]</div>';
    }
  }

  init();
})();
