const API_BASE      = "/api";
const PD_PROXY_URL  = "/api/pd";
const CF_BASE       = "https://minitube-stream.f0471649.workers.dev/playlist/";
const THUMB_CDN_URL = "https://thambnailloader.n58815396.workers.dev/";
const MY_ADMIN_ID   = "1326069145";

// Global video lists
let allVideos    = [];
let shortsVideos = [];
let longVideos   = [];

// Player instances
let hlsPlayer  = null;
let plyrPlayer = null;

// === Structured Home Feed State ===
let homeShorts    = [];
let homeLongs     = [];
let homeShortsPtr = 0;
let homeLongsPtr  = 0;
let homePhase     = 0; // 0 = shorts shelf, 1 = longs block
let homeObserver  = null;

const SHELF_SIZE    = 4;  // always show 4 shorts in a shelf
const LONGS_BLOCK   = 5;  // 5 long videos per block
const BLOCKS_RENDER = 2;  // blocks to render per scroll event

// Shorts state
let currentPlaylist = [];
let currentShortIdx = 0;
let watchedShortIds = [];
let shortsHlsMap    = {};
let startY          = 0;
let isDragging      = false;
let globalMuted     = true;
let lastTapTime     = 0;

// Player seek state
let playerLastTapTime = 0;
let playerAbortController = null;

// DOM refs
const mainContent   = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");
const videoOverlay  = document.getElementById("video-player-overlay");
const shortsOverlay = document.getElementById("shorts-fullscreen-container");
const shortsFeed    = document.getElementById("shorts-wrapper");

/* =========================================
   1. INIT
========================================= */
let searchTimeout = null;

window.addEventListener("DOMContentLoaded", async () => {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            if (searchTimeout) clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchVideos();
            }, 300);
        });
        searchInput.addEventListener("keypress", e => { 
            if (e.key === "Enter") {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchVideos(); 
            }
        });
    }

    window.addEventListener("keydown", e => {
        if (videoOverlay && !videoOverlay.classList.contains("hidden") && e.code === "Escape") closePlayer();
    });

    await fetchAllVideos();
    loadHome();
    setupShortsTouchEngine();
});

async function fetchAllVideos() {
    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        const res = await fetch(`${API_BASE}/videos/recommended`, {
            headers: { 'x-telegram-init-data': initData }
        });
        allVideos    = await res.json();
        shortsVideos = allVideos.filter(v => v.type === "short");
        longVideos   = allVideos.filter(v => v.type === "long" || v.type === "hls_movie");
    } catch(e) { console.error("Fetch error:", e); }
}

/* =========================================
   2. ALGORITHM — 40/30/30 (CLIENT-SIDE)
========================================= */
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function buildRatioFeed(videos, refTags = [], refCatId = null, excludeIds = new Set(), total = 15) {
    const n_sim   = Math.round(total * 0.4);
    const n_new   = Math.round(total * 0.3);
    const n_trend = total - n_sim - n_new;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const available = videos.filter(v => !excludeIds.has(v._id));
    const similar   = available.filter(v =>
        v.category_id === refCatId || (v.tags && refTags.some(t => v.tags.includes(t)))
    );
    const newVids   = available.filter(v => v.created_at && (now - new Date(v.created_at).getTime() < sevenDays));
    const trending  = [...available].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));

    const seen   = new Set(excludeIds);
    const result = [];

    function pick(pool, n) {
        let count = 0;
        for (const v of pool) {
            if (count >= n) break;
            if (!seen.has(v._id)) { result.push(v); seen.add(v._id); count++; }
        }
    }

    pick(shuffleArray(similar), n_sim);
    pick(newVids, n_new);
    pick(trending, n_trend);

    if (result.length < total) {
        for (const v of shuffleArray(available)) {
            if (result.length >= total) break;
            if (!seen.has(v._id)) { result.push(v); seen.add(v._id); }
        }
    }
    return result;
}

/* =========================================
   3. HOME FEED — STRUCTURED BLOCKS (YouTube-style)
   Pattern: [4 Shorts] → [5 Longs] → [4 Shorts] → [5 Longs] …
========================================= */
function loadHome() {
    setActiveNav(0);
    if (homeObserver) homeObserver.disconnect();
    homeShorts    = shuffleArray([...shortsVideos]);
    homeLongs     = shuffleArray([...longVideos]);
    homeShortsPtr = 0;
    homeLongsPtr  = 0;
    homePhase     = (shortsVideos.length > 0) ? 0 : 1;
    mainContent.innerHTML = "";
    renderHomeBlocks(3);
    setupInfiniteScroll();
}

function nextShortsBatch() {
    if (homeShorts.length === 0) return [];
    const items = [];
    for (let j = 0; j < SHELF_SIZE; j++) {
        items.push(homeShorts[homeShortsPtr % homeShorts.length]);
        homeShortsPtr++;
        if (homeShortsPtr >= homeShorts.length) {
            homeShorts = shuffleArray([...shortsVideos]);
            homeShortsPtr = 0;
        }
    }
    return items;
}

function nextLongsBatch() {
    if (homeLongs.length === 0) return [];
    const items = [];
    const count = Math.min(LONGS_BLOCK, homeLongs.length);
    for (let j = 0; j < count; j++) {
        if (homeLongsPtr >= homeLongs.length) {
            homeLongs = shuffleArray([...longVideos]);
            homeLongsPtr = 0;
        }
        items.push(homeLongs[homeLongsPtr++]);
    }
    return items;
}

function renderHomeBlocks(numBlocks) {
    for (let b = 0; b < numBlocks; b++) {
        if (homePhase === 0 && shortsVideos.length > 0) {
            // === Shorts Shelf — always SHELF_SIZE (4) ===
            const shorts = nextShortsBatch();
            if (shorts.length > 0) {
                const shelf = document.createElement("div");
                shelf.className = "shorts-shelf";
                shelf.innerHTML = `
                    <div class="shorts-shelf-title"><i class="fas fa-bolt"></i> Scrolls</div>
                    <div class="shorts-grid">
                        ${shorts.map(s => `
                            <div class="short-card-home" onclick="openShortsPlayer('${s._id}')">
                                <img loading="lazy" src="${THUMB_CDN_URL}${s._id}.jpg"
                                    onerror="this.src='https://via.placeholder.com/200x350'">
                                <div class="title">${s.title}</div>
                            </div>`).join('')}
                    </div>`;
                mainContent.insertBefore(shelf, document.getElementById("scroll-sentinel") || null);
            }
            homePhase = longVideos.length > 0 ? 1 : 0;

        } else if (longVideos.length > 0) {
            // === Long Videos Block (5 videos) ===
            const longs = nextLongsBatch();
            longs.forEach(v => {
                const card = document.createElement("div");
                card.className = "video-card";
                card.onclick   = () => openLongPlayer(v._id);
                card.innerHTML = `
                    <img loading="lazy" class="thumbnail" src="${THUMB_CDN_URL}${v._id}.jpg"
                        onerror="this.src='https://via.placeholder.com/640x360'">
                    <div class="card-info">
                        <div class="v-title">${v.title}</div>
                        <div class="v-meta">${v.view_count || 0} views</div>
                    </div>`;
                mainContent.insertBefore(card, document.getElementById("scroll-sentinel") || null);
            });
            homePhase = shortsVideos.length > 0 ? 0 : 1;
        } else { break; }
    }

    // Ensure sentinel is always at end
    let sent = document.getElementById("scroll-sentinel");
    if (!sent) {
        sent = document.createElement("div");
        sent.id = "scroll-sentinel";
        sent.style.height = "10px";
    }
    mainContent.appendChild(sent);
    if (homeObserver) homeObserver.observe(sent);
}

function setupInfiniteScroll() {
    homeObserver = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        renderHomeBlocks(BLOCKS_RENDER);
    }, { rootMargin: '400px' });
    const sentinel = document.getElementById("scroll-sentinel");
    if (sentinel) homeObserver.observe(sentinel);
}

/* =========================================
   4. TRENDING TAB
========================================= */
function loadTrendingTab() {
    setActiveNav(1);
    if (homeObserver) homeObserver.disconnect();
    const trending = [...longVideos].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    mainContent.innerHTML = `<h2 class="section-header" style="padding:15px;"><i class="fas fa-fire" style="color:#ff6b35;"></i> Trending</h2>`;
    if (trending.length === 0) {
        mainContent.innerHTML += `<div class="empty-state"><i class="fas fa-fire"></i><p>No trending videos yet</p></div>`;
        return;
    }
    trending.forEach(v => {
        const card = document.createElement("div");
        card.className = "video-card";
        card.onclick   = () => openLongPlayer(v._id);
        card.innerHTML = `
            <img loading="lazy" class="thumbnail" src="${THUMB_CDN_URL}${v._id}.jpg"
                onerror="this.src='https://via.placeholder.com/640x360'">
            <div class="card-info">
                <div class="v-title">${v.title}</div>
                <div class="v-meta"><i class="fas fa-fire" style="color:#ff6b35;"></i> ${v.view_count || 0} views</div>
            </div>`;
        mainContent.appendChild(card);
    });
}

function loadShortsTab() {
    setActiveNav(2);
    openShortsPlayer(shortsVideos[0]?._id);
}

/* =========================================
   5. CATEGORIES
========================================= */
async function loadCategoriesTab() {
    setActiveNav(3);
    if (homeObserver) homeObserver.disconnect();
    mainContent.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i></div>`;
    try {
        const cats = await (await fetch(`${API_BASE}/categories`)).json();
        const allV = await (await fetch(`${API_BASE}/videos`)).json(); 
        
        // Update global state with fresh data
        allV.forEach(v => {
            if (!allVideos.find(a => a._id === v._id)) {
                allVideos.push(v);
                if (v.type === "short") shortsVideos.push(v);
                else longVideos.push(v);
            }
        });

        mainContent.innerHTML = "";
        for (const cat of cats) {
            const catVideos = allV.filter(v => v.category_id === cat._id);
            if (catVideos.length === 0) continue;
            const sec = document.createElement("div");
            sec.className = "category-section";
            sec.innerHTML = `
                <div class="category-header">
                    <h2>${cat.name}</h2>
                    <span class="view-all" onclick="viewAllCategory('${cat._id}', '${cat.name}')">View All</span>
                </div>
                <div class="category-horizontal-scroll">
                    ${catVideos.slice(0, 8).map(v => `
                        <div class="category-video-card" onclick="${v.type !== 'short' ? `openLongPlayer('${v._id}')` : `openShortsPlayer('${v._id}')`}">
                            <div class="thumbnail-container"><img loading="lazy" src="${THUMB_CDN_URL}${v._id}.jpg" onerror="this.src='https://via.placeholder.com/320x180'"></div>
                            <div class="video-info"><h3 style="font-size:12px;">${v.title}</h3></div>
                        </div>`).join('')}
                </div>`;
            mainContent.appendChild(sec);
        }
    } catch(e) { mainContent.innerHTML = "<div style='text-align:center;padding:30px;'>Error loading categories</div>"; }
}

async function viewAllCategory(catId, catName) {
    if (homeObserver) homeObserver.disconnect();
    window.scrollTo(0, 0); // FIX: Reset scroll on sub-navigation
    mainContent.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i></div>`;
    
    try {
        const res = await fetch(`${API_BASE}/videos?category_id=${catId}`);
        const results = await res.json();
        
        // Update global state
        results.forEach(v => {
            if (!allVideos.find(a => a._id === v._id)) {
                allVideos.push(v);
                if (v.type === "short") shortsVideos.push(v);
                else longVideos.push(v);
            }
        });

        mainContent.innerHTML = `<h2 class="section-header" style="padding:15px;"><i class="fas fa-arrow-left" onclick="loadCategoriesTab()" style="cursor:pointer;margin-right:8px;"></i>${catName}</h2>`;
        if (results.length === 0) {
            mainContent.innerHTML += `<div class="empty-state"><i class="fas fa-play"></i><p>No videos in this category</p></div>`;
        } else {
            results.forEach(v => {
                const isShort = v.type === 'short';
                const card = document.createElement("div");
                card.className = "video-card";
                card.onclick   = () => isShort ? openShortsPlayer(v._id) : openLongPlayer(v._id);
                card.innerHTML = `
                    <img loading="lazy" class="thumbnail" src="${THUMB_CDN_URL}${v._id}.jpg" onerror="this.src='https://via.placeholder.com/640x360'">
                    <div class="card-info">
                        <div class="v-title">${v.title}</div>
                        <div class="v-meta">${v.view_count || 0} views • ${isShort ? 'Short' : 'Video'}</div>
                    </div>`;
                mainContent.appendChild(card);
            });
        }
    } catch(e) { mainContent.innerHTML = "<div style='text-align:center;padding:30px;'>Error loading videos</div>"; }
}

/* =========================================
   6. SEARCH
========================================= */
let searchAbortController = null;

async function searchVideos() {
    const query = document.getElementById("searchInput").value.trim();
    if (!query) { loadHome(); return; }
    if (homeObserver) homeObserver.disconnect();
    
    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    
    setActiveNav(-1);
    mainContent.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i><span style="font-size:14px;">Searching…</span></div>`;
    try {
        const res = await fetch(`${API_BASE}/videos/search?q=${encodeURIComponent(query)}`, { signal: searchAbortController.signal });
        const results = await res.json();
        
        // FIX: Add to global state
        results.forEach(v => {
            if (!allVideos.find(a => a._id === v._id)) {
                allVideos.push(v);
                if (v.type === "short") shortsVideos.push(v);
                else longVideos.push(v);
            }
        });

        mainContent.innerHTML = `<h2 class="section-header" style="padding:15px;"><i class="fas fa-search"></i> "${query}"</h2>`;
        if (results.length === 0) {
            mainContent.innerHTML += `<div class="empty-state"><i class="fas fa-search"></i><p>No videos found</p><span>Try a different keyword</span></div>`;
        } else {
            results.forEach(v => {
                const isShort = v.type === 'short';
                const card = document.createElement("div");
                card.className = "video-card";
                card.onclick   = () => isShort ? openShortsPlayer(v._id) : openLongPlayer(v._id);
                card.innerHTML = `
                    <img loading="lazy" class="thumbnail" src="${THUMB_CDN_URL}${v._id}.jpg" onerror="this.src='https://via.placeholder.com/640x360'">
                    <div class="card-info">
                        <div class="v-title">${v.title}</div>
                        <div class="v-meta">${v.view_count || 0} views • ${isShort ? 'Short' : 'Video'}</div>
                    </div>`;
                mainContent.appendChild(card);
            });
        }
    } catch(e) { 
        if (e.name !== 'AbortError') mainContent.innerHTML = "<div style='text-align:center;padding:30px;'>Search failed.</div>"; 
    }
}

function setActiveNav(index) {
    bottomNavItems.forEach((item, i) => item.classList.toggle("active", i === index));
    window.scrollTo({ top: 0, behavior: 'auto' });
}

/* =========================================
   7. LONG PLAYER (PLYR + HLS)
========================================= */
function openLongPlayer(videoId) {
    const vData = allVideos.find(v => v._id === videoId);
    if (!vData) return;

    videoOverlay.classList.remove("hidden");
    videoOverlay.classList.add("active");
    videoOverlay.scrollTo(0, 0);

    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";

    // Destroy old instances BEFORE re-querying
    if (plyrPlayer) { try { plyrPlayer.destroy(); } catch(e) {} plyrPlayer = null; }
    if (hlsPlayer)  { try { hlsPlayer.destroy();  } catch(e) {} hlsPlayer  = null; }

    // Re-query the video element from DOM because Plyr might have replaced it
    let videoEl = document.getElementById("longVideoPlayer");
    if (!videoEl) {
        // Recovery: if Plyr destroyed the node and it's missing, we need to ensure it exists
        const container = document.getElementById("playerContainer");
        const oldBackBtn = container.querySelector(".player-back-btn");
        container.innerHTML = "";
        if (oldBackBtn) container.appendChild(oldBackBtn);
        videoEl = document.createElement("video");
        videoEl.id = "longVideoPlayer";
        videoEl.setAttribute("playsinline", "");
        container.appendChild(videoEl);
    }

    videoEl.src = "";
    videoEl.load();

    const hlsUrl = `${CF_BASE}${videoId}.m3u8`;

    // Init Plyr
    if (typeof Plyr !== "undefined") {
        plyrPlayer = new Plyr(videoEl, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'settings', 'fullscreen'],
            settings: ['speed'],
            speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
            disableContextMenu: false
        });
    }

    // Attach HLS
    if (Hls.isSupported()) {
        hlsPlayer = new Hls({ startLevel: -1, autoLevelEnabled: true });
        hlsPlayer.loadSource(hlsUrl);
        hlsPlayer.attachMedia(videoEl);
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
            if (videoEl) videoEl.play().catch(() => {});
        });
        hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal && videoEl) { 
                hlsPlayer.destroy(); // Fix: Destroy broken instance
                videoEl.src = `${API_BASE}/stream/${videoId}`; 
                videoEl.play().catch(() => {}); 
            }
        });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = hlsUrl;
        videoEl.play().catch(() => {});
    } else {
        videoEl.src = `${API_BASE}/stream/${videoId}`;
        videoEl.play().catch(() => {});
    }

    // Buffering spinner
    setupPlayerSpinner(videoEl);

    // Double-tap seek
    setupPlayerDoubleTap();

    const initData = window.Telegram?.WebApp?.initData || "";
    fetch(`${API_BASE}/views/${videoId}`, { method: 'POST', headers: { 'x-telegram-init-data': initData } }).catch(() => {});
    loadRelatedVideos(videoId, vData);
}

function setupPlayerSpinner(videoEl) {
    const spinner = document.getElementById("player-spinner");
    if (!spinner) return;
    spinner.classList.add("hidden");
    videoEl.onwaiting = () => spinner.classList.remove("hidden");
    videoEl.onplaying = () => spinner.classList.add("hidden");
    videoEl.oncanplay = () => spinner.classList.add("hidden");
}

function setupPlayerDoubleTap() {
    const container = document.getElementById("playerContainer");
    if (!container) return;

    if (playerAbortController) {
        playerAbortController.abort();
    }
    playerAbortController = new AbortController();
    const { signal } = playerAbortController;

    container.addEventListener("touchend", e => {
        // Ignore if it's on the back button
        if (e.target.closest(".player-back-btn")) return;

        const now = Date.now();
        if (now - playerLastTapTime < 280) {
            e.preventDefault(); // FIX: Prevent Plyr play/pause on seek tap
            // Double tap — seek
            const x     = e.changedTouches[0].clientX;
            const width = container.offsetWidth;
            const videoEl = document.getElementById("longVideoPlayer");
            if (!videoEl) return;

            if (x < width / 2) {
                videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
                showSeekFeedback("left");
            } else {
                videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
                showSeekFeedback("right");
            }
            playerLastTapTime = 0; // reset to avoid triple-tap triggering again
        } else {
            playerLastTapTime = now;
        }
    }, { passive: false, signal }); // FIX: passive false for preventDefault
}

function showSeekFeedback(dir) {
    const el = document.getElementById(`seek-${dir}`);
    if (!el) return;
    el.classList.remove("active");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("active");
    setTimeout(() => el.classList.remove("active"), 600);
}

function closePlayer() {
    if (playerAbortController) {
        playerAbortController.abort();
        playerAbortController = null;
    }
    videoOverlay.classList.add("hidden");
    videoOverlay.classList.remove("active");
    if (plyrPlayer) { try { plyrPlayer.destroy(); } catch(e) {} plyrPlayer = null; }
    if (hlsPlayer)  { try { hlsPlayer.destroy();  } catch(e) {} hlsPlayer  = null; }
    const videoEl = document.getElementById("longVideoPlayer");
    if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute("src"); // FIX: iOS memory leak cleanup
        videoEl.src = ""; 
        videoEl.load();
    }
    const spinner = document.getElementById("player-spinner");
    if (spinner) spinner.classList.add("hidden");
    // Remove touch listeners
    const container = document.getElementById("playerContainer");
    if (container) container.ontouchend = null;
}

async function loadRelatedVideos(videoId, vData) {
    const container = document.getElementById("related-videos-container");
    container.innerHTML = `<div class="section-loader" style="padding:20px;font-size:22px;"><i class="fas fa-circle-notch fa-spin"></i></div>`;
    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        const res    = await fetch(`${API_BASE}/videos/related/${videoId}`, {
            headers: { 'x-telegram-init-data': initData }
        });
        const related = await res.json();
        container.innerHTML = "";
        related.slice(0, 20).forEach(v => {
            const card = document.createElement("div");
            card.className = "related-video-card";
            card.onclick   = () => { openLongPlayer(v._id); videoOverlay.scrollTo(0, 0); };
            card.innerHTML = `
                <div class="related-thumb">
                    <img loading="lazy" src="${THUMB_CDN_URL}${v._id}.jpg"
                        onerror="this.src='https://via.placeholder.com/140x80'">
                </div>
                <div class="related-info">
                    <h4>${v.title}</h4>
                    <p>${v.view_count || 0} views</p>
                </div>`;
            container.appendChild(card);
        });
    } catch(e) {
        container.innerHTML = "";
        buildRatioFeed(longVideos, vData?.tags || [], vData?.category_id || null, new Set([videoId]), 15)
            .forEach(v => {
                const card = document.createElement("div");
                card.className = "related-video-card";
                card.onclick   = () => { openLongPlayer(v._id); videoOverlay.scrollTo(0, 0); };
                card.innerHTML = `
                    <div class="related-thumb"><img loading="lazy" src="${THUMB_CDN_URL}${v._id}.jpg" onerror="this.src='https://via.placeholder.com/140x80'"></div>
                    <div class="related-info"><h4>${v.title}</h4><p>${v.view_count || 0} views</p></div>`;
                container.appendChild(card);
            });
    }
}

/* =========================================
   8. SHORTS ENGINE — SMART PLAYLIST (40/30/30)
========================================= */
async function openShortsPlayer(targetId = null) {
    shortsOverlay.classList.remove("hidden");
    shortsOverlay.style.display = "block";

    watchedShortIds = [];
    Object.values(shortsHlsMap).forEach(h => { try { h.destroy(); } catch(e) {} });
    shortsHlsMap    = {};
    currentPlaylist = [];
    currentShortIdx = 0;
    shortsFeed.innerHTML = "";

    await loadShortsPlaylist(targetId);
}

async function loadShortsPlaylist(startId = null) {
    const watchedParam = watchedShortIds.slice(-20).join(",");
    let playlist = [];
    try {
        const res = await fetch(`${API_BASE}/shorts/playlist?watched_ids=${watchedParam}&limit=10`);
        playlist = await res.json();
    } catch(e) {
        playlist = buildRatioFeed(shortsVideos, [], null, new Set(watchedShortIds), 10);
    }

    if (playlist.length === 0 && shortsVideos.length > 0) {
        watchedShortIds = [];
        playlist = shuffleArray([...shortsVideos]).slice(0, 10);
    }

    // Put target first
    if (startId) {
        const idx = playlist.findIndex(v => v._id === startId);
        if (idx > 0)      { const [item] = playlist.splice(idx, 1); playlist.unshift(item); }
        else if (idx === -1) {
            const t = shortsVideos.find(v => v._id === startId);
            if (t) playlist.unshift(t);
        }
    }

    currentPlaylist = playlist;
    currentShortIdx = 0;
    renderShortsPlaylist();
}

function renderShortsPlaylist() {
    shortsFeed.innerHTML = "";
    currentPlaylist.forEach((v, i) => {
        const reel = document.createElement("div");
        reel.className = "short-player-item";
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted
                style="width:100%;height:100%;object-fit:cover;"></video>
            <div class="short-info-overlay">
                <b class="short-title-text">${v.title}</b>
            </div>
            <div class="short-progress-wrap">
                <div id="short-progress-${i}" class="short-progress-bar"></div>
            </div>
            <div class="short-mute-hint" id="mute-hint-${i}" style="display:${globalMuted ? 'flex' : 'none'}">
                <i class="fas fa-volume-mute"></i><span>Tap to unmute</span>
            </div>`;
        shortsFeed.appendChild(reel);
    });
    snapToShort(0, false);
}

let tapTimeout = null;

function setupShortsTouchEngine() {
    if (!shortsOverlay) return;

    shortsOverlay.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        isDragging = true;
        shortsFeed.style.transition = "none";
    }, { passive: true });

    shortsOverlay.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const deltaY = e.touches[0].clientY - startY;
        shortsFeed.style.transform = `translateY(calc(-${currentShortIdx * 100}vh + ${deltaY}px))`;
    }, { passive: true });

    shortsOverlay.addEventListener('touchend', async e => {
        isDragging = false;
        const deltaY = e.changedTouches[0].clientY - startY;
        const now    = Date.now();
        const since  = now - lastTapTime;

        if (Math.abs(deltaY) < 10) {
            if (since < 300) {
                if (tapTimeout) clearTimeout(tapTimeout);
                handleShortDoubleTap();
                lastTapTime = 0;
            } else {
                tapTimeout = setTimeout(() => {
                    handleShortTap();
                }, 300);
                lastTapTime = now;
            }
        } else if (deltaY < -50) {
            if (currentShortIdx < currentPlaylist.length - 1) {
                currentShortIdx++;
                snapToShort(currentShortIdx);
                if (currentShortIdx >= currentPlaylist.length - 2) {
                    await appendNextShortsBatch();
                }
            }
        } else if (deltaY > 50 && currentShortIdx > 0) {
            currentShortIdx--;
            snapToShort(currentShortIdx);
        }
    });
}

async function appendNextShortsBatch() {
    const watchedParam = watchedShortIds.join(",");
    let newBatch = [];
    try {
        const res = await fetch(`${API_BASE}/shorts/playlist?watched_ids=${watchedParam}&limit=10`);
        newBatch = await res.json();
    } catch(e) {
        newBatch = buildRatioFeed(shortsVideos, [], null, new Set(watchedShortIds), 10);
    }
    if (newBatch.length === 0) return;

    const startIdx = currentPlaylist.length;
    currentPlaylist.push(...newBatch);

    newBatch.forEach((v, relIdx) => {
        const i    = startIdx + relIdx;
        const reel = document.createElement("div");
        reel.className = "short-player-item";
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted
                style="width:100%;height:100%;object-fit:cover;"></video>
            <div class="short-info-overlay">
                <b class="short-title-text">${v.title}</b>
            </div>
            <div class="short-progress-wrap">
                <div id="short-progress-${i}" class="short-progress-bar"></div>
            </div>
            <div class="short-mute-hint" id="mute-hint-${i}" style="display:none">
                <i class="fas fa-volume-mute"></i><span>Tap to unmute</span>
            </div>`;
        shortsFeed.appendChild(reel);
    });
}

function snapToShort(idx, animate = true) {
    if (!currentPlaylist[idx]) return;
    shortsFeed.style.transition = animate
        ? "transform 0.38s cubic-bezier(0.25, 1, 0.5, 1)"
        : "none";
    shortsFeed.style.transform = `translateY(-${idx * 100}vh)`;

    currentPlaylist.forEach((v, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if (!vid) return;

        if (i === idx) {
            if (!vid.src && !shortsHlsMap[i]) {
                const url = `${CF_BASE}${v._id}.m3u8`;
                if (Hls.isSupported()) {
                    const h = new Hls({ startLevel: -1, autoLevelEnabled: true });
                    shortsHlsMap[i] = h;
                    h.on(Hls.Events.MANIFEST_PARSED, () => {
                        vid.play().catch(() => {});
                    });
                    h.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) {
                            vid.src = `${API_BASE}/stream/${v._id}`;
                            vid.play().catch(() => {});
                        }
                    });
                    h.loadSource(url);
                    h.attachMedia(vid);
                } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
                    vid.src = url;
                    vid.play().catch(() => {});
                } else {
                    vid.src = `${API_BASE}/stream/${v._id}`;
                    vid.play().catch(() => {});
                }
            } else {
                vid.play().catch(() => {});
            }
            vid.muted = globalMuted;
            updateShortProgress(vid, i); // FIX: Enable Shorts progress bar

            const hint = document.getElementById(`mute-hint-${i}`);
            if (hint) hint.style.display = globalMuted ? 'flex' : 'none';

            // FIX: Prevent view count spam on rapid scroll
            if (!watchedShortIds.includes(v._id)) {
                watchedShortIds.push(v._id);
                const initData = window.Telegram?.WebApp?.initData || "";
                fetch(`${API_BASE}/views/${v._id}`, { method: 'POST', headers: { 'x-telegram-init-data': initData } }).catch(() => {});
            }

            // Preload next
            if (i + 1 < currentPlaylist.length) {
                const nextVid = document.getElementById(`short-vid-${i + 1}`);
                const nextV   = currentPlaylist[i + 1];
                if (nextVid && !nextVid.src && !shortsHlsMap[i + 1]) {
                    const nextUrl = `${CF_BASE}${nextV._id}.m3u8`;
                    if (Hls.isSupported()) {
                        const h = new Hls();
                        h.loadSource(nextUrl);
                        h.attachMedia(nextVid);
                        shortsHlsMap[i + 1] = h;
                    }
                }
            }
        } else {
            vid.pause();
            // Memory Management: Keep only ±3 range active
            if (Math.abs(i - idx) > 3) {
                if (shortsHlsMap[i]) {
                    try { shortsHlsMap[i].destroy(); } catch(e) {}
                    delete shortsHlsMap[i];
                }
                vid.removeAttribute('src'); // FIX: CRITICAL FOR iOS
                vid.src = "";
                vid.load(); // Free memory
            }
        }
    });
}

function updateShortProgress(vid, i) {
    vid.ontimeupdate = () => {
        const bar = document.getElementById(`short-progress-${i}`);
        if (bar && vid.duration) bar.style.width = (vid.currentTime / vid.duration * 100) + "%";
    };
}

function handleShortTap() {
    globalMuted = !globalMuted;
    const vid  = document.getElementById(`short-vid-${currentShortIdx}`);
    if (vid) vid.muted = globalMuted;
    const hint = document.getElementById(`mute-hint-${currentShortIdx}`);
    if (hint) {
        hint.style.animation = 'none';
        hint.style.display = globalMuted ? 'flex' : 'none';
        void hint.offsetWidth; // Force Reflow
        hint.style.animation = 'fadeHint 2s ease forwards';
    }
}

function handleShortDoubleTap() {
    const vid = document.getElementById(`short-vid-${currentShortIdx}`);
    if (!vid) return;
    if (vid.paused) vid.play(); else vid.pause();
}

function closeShorts() {
    shortsOverlay.classList.add("hidden");
    shortsOverlay.style.display = "none";
    Object.values(shortsHlsMap).forEach(h => { try { h.destroy(); } catch(e) {} });
    shortsHlsMap = {};
    currentPlaylist.forEach((_, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if (vid) { 
            vid.pause(); 
            vid.removeAttribute('src'); // FIX: Ensure full memory cleanup on close
            vid.src = ""; 
            vid.load();
        }
    });
    shortsFeed.innerHTML = "";
    currentPlaylist = [];
}
