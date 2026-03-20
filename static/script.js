const API_BASE      = "/api";
const PD_PROXY_URL  = "/api/pd";
const CF_BASE       = "/api/hls/";
const THUMB_CDN_URL = "https://thambnailloader.n58815396.workers.dev/";
const MY_ADMIN_ID   = "1326069145";

// Global video lists
let allVideos    = [];
let shortsVideos = [];
let longVideos   = [];

// Player instance
let hlsPlayer = null;

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
let globalMuted     = false; // FIX: default unmuted — browser policy handled via setActiveVideo
let lastTapTime     = 0;

// FIX: Global video lock — only ONE video plays at any time
let activeVideo = null;

function setActiveVideo(videoEl) {
    if (activeVideo && activeVideo !== videoEl) {
        activeVideo.pause();
        activeVideo.removeAttribute("src");
        activeVideo.load();
    }
    activeVideo = videoEl;
}

// FIX: Cleanup ALL videos + all HLS instances
function cleanupAllVideos() {
    document.querySelectorAll("video").forEach(v => {
        v.pause();
        v.removeAttribute("src");
        v.load();
    });
    Object.values(shortsHlsMap).forEach(h => { try { h.destroy(); } catch(e) {} });
    shortsHlsMap = {};
}

// Player seek state
let playerLastTapTime = 0;
let playerAbortController = null;

/* =========================================
   AD SYSTEM CONSTANTS & STATE
========================================= */
// Adsgram block IDs
const ADSGRAM_BLOCK_REWARDED = "25543"; // Rewarded entry gate
const ADSGRAM_BLOCK_PREROLL  = "25543"; // Pre-roll before long video

// 24h unlock gate
const AD_UNLOCK_KEY = "ad_unlock_time";
const AD_24H_MS     = 24 * 60 * 60 * 1000;

// Interstitial (Monetag) — trigger after N interactions, with cooldown
let interactionCount      = 0;
const INTERSTITIAL_EVERY  = 4;           // fire every 4th interaction
const INTERSTITIAL_COOLDOWN = 30000;     // minimum 30s between interstitials
let lastInterstitialTime  = 0;
let isAdPlaying           = false;       // blocks interstitial during video play

// In-feed ad counter — insert ad card every N long video cards in the home feed
let homeFeedCardCount = 0;
const INFEED_AD_EVERY = 4;

// DOM refs
const mainContent   = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");
const videoOverlay  = document.getElementById("video-player-overlay");
const shortsOverlay = document.getElementById("shorts-fullscreen-container");
const shortsFeed    = document.getElementById("shorts-wrapper");

/* =========================================
   AD SYSTEM — FUNCTIONS
========================================= */

// --- 1. Unlock Gate (Rewarded Entry — Adsgram Block 25530) ---
function checkAdGate() {
    const lastUnlock = localStorage.getItem(AD_UNLOCK_KEY);
    const now = Date.now();
    if (!lastUnlock || (now - parseInt(lastUnlock, 10)) > AD_24H_MS) {
        // 24h window expired — show unlock screen
        document.getElementById("app-unlock-screen").classList.remove("hidden");
        document.getElementById("main-app").classList.add("hidden");
    } else {
        startMainApp();
    }
}

// Called when user clicks "Watch Ad & Unlock" button
async function onUnlockClick() {
    const btn = document.getElementById("unlock-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading Ad…';
    try {
        if (!window.Adsgram) throw new Error("Adsgram SDK not ready");
        // Show rewarded ad — user must complete or skip to proceed
        const controller = await window.Adsgram.init({ blockId: ADSGRAM_BLOCK_REWARDED });
        await controller.show();
        // Ad completed — grant 24h access
        localStorage.setItem(AD_UNLOCK_KEY, Date.now().toString());
    } catch(e) {
        // Ad failed, errored, or Adsgram unavailable — grant limited access anyway
        // (don't hard-block users when ads fail — policy-compliant UX)
        if (!localStorage.getItem(AD_UNLOCK_KEY)) {
            localStorage.setItem(AD_UNLOCK_KEY, Date.now().toString());
        }
    } finally {
        document.getElementById("app-unlock-screen").classList.add("hidden");
        startMainApp();
    }
}

// Start the main app (called after unlock or if still within 24h)
async function startMainApp() {
    document.getElementById("main-app").classList.remove("hidden");
    await fetchAllVideos();
    loadHome();
    setupShortsTouchEngine();
    // Show sticky banner after 10s (non-intrusive delay)
    setTimeout(() => {
        const banner = document.getElementById("sticky-ad-banner");
        if (banner) banner.classList.remove("hidden");
    }, 10000);
}

// Close sticky banner (user-initiated, per policy)
function closeStickyBanner() {
    const banner = document.getElementById("sticky-ad-banner");
    if (banner) banner.classList.add("hidden");
}

// --- 2. Pre-Roll Ad (Adsgram — before long video) ---
// Shows ad THEN calls _startLongPlayerHls(videoId) in finally block
async function _showPrerollThenPlay(videoId) {
    if (!window.Adsgram) {
        // Adsgram not loaded — go straight to video
        _startLongPlayerHls(videoId);
        return;
    }
    try {
        isAdPlaying = true;
        const controller = await window.Adsgram.init({ blockId: ADSGRAM_BLOCK_PREROLL });
        await controller.show(); // user can skip after 5s (Adsgram default)
    } catch(e) {
        // Ad skipped, errored, or no fill — always continue to video
    } finally {
        isAdPlaying = false;
        _startLongPlayerHls(videoId);
    }
}

// --- 3. Interstitial (Monetag — after every N interactions) ---
// Must NOT interrupt active video playback
function trackInteraction() {
    interactionCount++;
    const now = Date.now();
    const videoPaused = !activeVideo || activeVideo.paused;
    if (
        interactionCount % INTERSTITIAL_EVERY === 0 &&
        (now - lastInterstitialTime) > INTERSTITIAL_COOLDOWN &&
        !isAdPlaying &&
        videoPaused
    ) {
        lastInterstitialTime = now;
        _fireInterstitial();
    }
}

function _fireInterstitial() {
    try {
        if (typeof show_10754897 === "function") {
            // Monetag in-app interstitial — policy-compliant settings
            show_10754897({
                type: "inApp",
                inAppSettings: {
                    frequency: 2,
                    capping: 0.1,
                    interval: 30,
                    timeout: 5,
                    everyPage: false
                }
            });
        }
    } catch(e) { /* Monetag unavailable — silently skip */ }
}

// --- 4. Home Video Banner Ad ---
// Small muted autoplay banner at the top of the home feed.
// Uses IntersectionObserver so the video only plays when visible (performance-safe).
// Replace VIDEO_AD_SRC with your actual ad network video URL.
const VIDEO_AD_SRC = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4";

let _bannerObserver = null; // keep ref so we can disconnect on tab switch

function _createHomeBanner() {
    const wrap = document.createElement("div");
    wrap.className = "home-video-banner";

    const vid = document.createElement("video");
    vid.muted      = true;
    vid.loop       = true;
    vid.playsInline = true;
    vid.preload    = "none";           // load only when visible
    vid.setAttribute("playsinline","");
    vid.setAttribute("webkit-playsinline","");
    // src is set lazily by IntersectionObserver below

    const overlay = document.createElement("div");
    overlay.className = "hvb-overlay";
    overlay.innerHTML = `
        <span class="hvb-badge"><i class="fas fa-rectangle-ad"></i> Sponsored</span>
        <span class="hvb-label">Tap to learn more</span>`;

    const muteIcon = document.createElement("div");
    muteIcon.className = "hvb-mute-icon";
    muteIcon.innerHTML = `<i class="fas fa-volume-mute"></i> Muted`;

    wrap.appendChild(vid);
    wrap.appendChild(overlay);
    wrap.appendChild(muteIcon);

    // Lazy-load + autoplay via IntersectionObserver
    if (_bannerObserver) _bannerObserver.disconnect();
    _bannerObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (!vid.src) {
                    vid.src = VIDEO_AD_SRC;
                    vid.load();
                }
                vid.play().catch(() => {});
            } else {
                vid.pause();
            }
        });
    }, { threshold: 0.3 });
    _bannerObserver.observe(wrap);

    return wrap;
}

// --- 5. In-Feed Native Ad Card (Monetag) ---
// Returns a DOM element that looks like a feed card but is clearly labelled "Sponsored"
function _createInFeedAdCard() {
    const card = document.createElement("div");
    card.className = "video-card in-feed-ad-card";
    card.innerHTML = `
        <div class="in-feed-ad-inner">
            <span class="ad-badge"><i class="fas fa-rectangle-ad"></i> Sponsored</span>
            <div class="infeed-ad-zone">
                <!-- Monetag native ad zone — replace with your Monetag native tag in production -->
                <span style="color:#555;font-size:12px;">Advertisement</span>
            </div>
        </div>`;
    return card;
}

// --- 5. Suggested Section Ad (Monetag — inside "Up Next") ---
function _createSuggestedAdCard() {
    const card = document.createElement("div");
    card.className = "suggested-ad-card";
    card.innerHTML = `
        <div class="suggested-ad-inner">
            <span class="ad-badge"><i class="fas fa-rectangle-ad"></i> Ad</span>
            <div class="suggested-ad-zone">
                <!-- Monetag native ad zone — replace with your Monetag native tag in production -->
                <span style="color:#555;font-size:12px;">Advertisement</span>
            </div>
        </div>`;
    return card;
}

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

    // Pause active video when tab goes to background
    document.addEventListener("visibilitychange", () => {
        if (document.hidden && activeVideo) activeVideo.pause();
    });

    // Check ad unlock gate — this is the new entry point
    checkAdGate();
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
    homeShorts     = shuffleArray([...shortsVideos]);
    homeLongs      = shuffleArray([...longVideos]);
    homeShortsPtr  = 0;
    homeLongsPtr   = 0;
    homePhase      = (shortsVideos.length > 0) ? 0 : 1;
    homeFeedCardCount = 0; // reset in-feed ad counter
    mainContent.innerHTML = "";
    // AD: video banner right below header, before any content
    mainContent.appendChild(_createHomeBanner());
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
            // === Long Videos Block (5 videos) with in-feed ad every INFEED_AD_EVERY cards ===
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

                // AD: insert in-feed sponsored card after every INFEED_AD_EVERY video cards
                homeFeedCardCount++;
                if (homeFeedCardCount % INFEED_AD_EVERY === 0) {
                    const adCard = _createInFeedAdCard();
                    mainContent.insertBefore(adCard, document.getElementById("scroll-sentinel") || null);
                }
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

    // Show player overlay immediately so user sees the shell while ad loads
    videoOverlay.classList.remove("hidden");
    videoOverlay.classList.add("active");
    videoOverlay.scrollTo(0, 0);

    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";

    // Cleanup all existing playback first
    cleanupAllVideos();
    if (hlsPlayer) { try { hlsPlayer.destroy(); } catch(e) {} hlsPlayer = null; }

    // Double-tap seek setup and side effects
    setupPlayerDoubleTap();
    const initData = window.Telegram?.WebApp?.initData || "";
    fetch(`${API_BASE}/views/${videoId}`, { method: 'POST', headers: { 'x-telegram-init-data': initData } }).catch(() => {});
    loadRelatedVideos(videoId, vData);

    // Track interaction for interstitial (only when video is paused/stopped)
    trackInteraction();

    // AD: show pre-roll, then start HLS when it completes or is skipped
    _showPrerollThenPlay(videoId);
}

// Actual HLS setup — called by _showPrerollThenPlay after ad finishes
function _startLongPlayerHls(videoId) {
    const videoEl = document.getElementById("longVideoPlayer");
    if (!videoEl) return;

    // Register as the only active video
    setActiveVideo(videoEl);
    videoEl.preload     = "metadata";
    videoEl.playsInline = true;
    videoEl.controls    = true;

    const hlsUrl = `${CF_BASE}${videoId}.m3u8`;

    // Single flag — prevents HLS error handler AND timeout from both firing fallback
    let _fallbackDone = false;
    let _fallbackTimer = null;

    function doFallbackMp4() {
        if (_fallbackDone) return;
        _fallbackDone = true;
        if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
        if (hlsPlayer) { try { hlsPlayer.destroy(); } catch(e) {} hlsPlayer = null; }
        videoEl.removeAttribute("src");
        videoEl.load();
        videoEl.src = `${API_BASE}/stream/${videoId}`;
        videoEl.addEventListener('canplay', () => {
            videoEl.muted = false;
            videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => {}); });
        }, { once: true });
        videoEl.load();
    }

    if (Hls.isSupported()) {
        // Optimal HLS config — fast start, low buffer, no wasted data
        hlsPlayer = new Hls({
            startLevel: 0,
            maxBufferLength: 6,
            maxMaxBufferLength: 12,
            abrEwmaDefaultEstimate: 300000,
            capLevelToPlayerSize: true,
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 0,
            autoStartLoad: true,
            manifestLoadingTimeOut: 5000
        });
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
            if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
            videoEl.muted = false;
            videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => {}); });
        });
        hlsPlayer.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) doFallbackMp4();
        });
        hlsPlayer.loadSource(hlsUrl);
        hlsPlayer.attachMedia(videoEl);
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        _fallbackDone = true;
        videoEl.src = hlsUrl;
        videoEl.addEventListener('canplay', () => {
            videoEl.muted = false;
            videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => {}); });
        }, { once: true });
        videoEl.load();
    } else {
        doFallbackMp4();
    }

    // Timeout fallback — fires if HLS hasn't resolved in 8s
    _fallbackTimer = setTimeout(() => { doFallbackMp4(); }, 8000);
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
        // Ignore back button
        if (e.target.closest(".player-back-btn")) return;

        const now = Date.now();
        if (now - playerLastTapTime < 280) {
            e.preventDefault(); // Prevent double-tap zoom
            // Double tap — 3-zone handling
            const x     = e.changedTouches[0].clientX;
            const width = container.offsetWidth;
            const ratio = x / width;
            const videoEl = document.getElementById("longVideoPlayer");
            if (!videoEl) return;

            if (ratio < 0.3) {
                // Left zone (0–30%) → rewind 10s
                videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
                showSeekFeedback("left");
            } else if (ratio > 0.7) {
                // Right zone (70–100%) → forward 10s
                videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
                showSeekFeedback("right");
            } else {
                // Center zone (30–70%) → play/pause toggle
                if (videoEl.paused) {
                    videoEl.play().catch(() => {});
                    showSeekFeedback("center-play");
                } else {
                    videoEl.pause();
                    showSeekFeedback("center-pause");
                }
            }
            playerLastTapTime = 0; // reset to avoid triple-tap triggering again
        } else {
            playerLastTapTime = now;
        }
    }, { passive: false, signal }); // passive: false required for preventDefault
}

function showSeekFeedback(dir) {
    let elId, iconClass;
    if (dir === "center-play") {
        elId = "seek-center";
        iconClass = "fa-play";
    } else if (dir === "center-pause") {
        elId = "seek-center";
        iconClass = "fa-pause";
    } else {
        elId = `seek-${dir}`;
    }
    const el = document.getElementById(elId);
    if (!el) return;
    // Update center icon if needed
    if (iconClass) {
        const icon = document.getElementById("seek-center-icon");
        if (icon) { icon.className = `fas ${iconClass}`; }
    }
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
    if (hlsPlayer) { try { hlsPlayer.destroy(); } catch(e) {} hlsPlayer = null; }
    // FIX: full cleanup on player close
    cleanupAllVideos();
    activeVideo = null;
    // Resume shorts if the shorts overlay is still open
    if (shortsOverlay && !shortsOverlay.classList.contains("hidden")) {
        const activeVid = document.getElementById(`short-vid-${currentShortIdx}`);
        if (activeVid) {
            setActiveVideo(activeVid);
            activeVid.muted = globalMuted;
            activeVid.play().catch(() => {});
        }
    }
}

function loadRelatedVideos(videoId, vData) {
    const container = document.getElementById("related-videos-container");
    container.innerHTML = "";
    // Use client-side 40/30/30 feed — instant, no 404 risk
    const related = buildRatioFeed(
        longVideos,
        vData?.tags || [],
        vData?.category_id || null,
        new Set([videoId]),
        15
    );
    // AD: insert suggested/sponsored ad card after the 1st related video
    const AD_POSITION = 1;
    related.forEach((v, idx) => {
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
        // Insert a clearly-labelled sponsored card after the 3rd item
        if (idx === AD_POSITION - 1) {
            container.appendChild(_createSuggestedAdCard());
        }
    });
}

/* =========================================
   8. SHORTS ENGINE — SMART PLAYLIST (40/30/30)
========================================= */
// FIXED: memory leak — destroy ALL HLS instances including preload ones
function destroyAllShortsHls() {
    Object.values(shortsHlsMap).forEach(h => { try { h.destroy(); } catch(e) {} });
    shortsHlsMap = {};
}

async function openShortsPlayer(targetId = null) {
    shortsOverlay.classList.remove("hidden");
    shortsOverlay.style.display = "block";

    // FIX: cleanup everything before starting shorts
    if (hlsPlayer) { try { hlsPlayer.stopLoad(); hlsPlayer.destroy(); } catch(e) {} hlsPlayer = null; }
    cleanupAllVideos();

    watchedShortIds = [];
    destroyAllShortsHls();
    currentPlaylist = [];
    currentShortIdx = 0;
    shortsFeed.innerHTML = "";

    await loadShortsPlaylist(targetId);
}

async function loadShortsPlaylist(startId = null) {
    // Use client-side feed directly — no network delay, no 404 risk
    let playlist = buildRatioFeed(shortsVideos, [], null, new Set(watchedShortIds), 10);

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
        // FIX: preload="metadata" saves data + faster UI; object-fit handled by CSS
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted preload="metadata"
                poster="${THUMB_CDN_URL}${v._id}.jpg"></video>
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
                trackInteraction(); // AD: count scroll as interaction for interstitial
                if (currentShortIdx >= currentPlaylist.length - 2) {
                    await appendNextShortsBatch();
                }
            }
        } else if (deltaY > 50 && currentShortIdx > 0) {
            currentShortIdx--;
            snapToShort(currentShortIdx);
            trackInteraction(); // AD: count scroll as interaction for interstitial
        }
    });
}

async function appendNextShortsBatch() {
    // Use client-side feed directly — no network delay, no 404 risk
    const newBatch = buildRatioFeed(shortsVideos, [], null, new Set(watchedShortIds), 10);
    if (newBatch.length === 0) return;

    const startIdx = currentPlaylist.length;
    currentPlaylist.push(...newBatch);

    newBatch.forEach((v, relIdx) => {
        const i    = startIdx + relIdx;
        const reel = document.createElement("div");
        reel.className = "short-player-item";
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted preload="metadata"
                poster="${THUMB_CDN_URL}${v._id}.jpg"></video>
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
            // --- Active short: load and play ---
            // FIX: race condition — per-index loading flag prevents double-init on rapid scroll
            if (!shortsHlsMap[i] && !vid.getAttribute('src') && !vid._hlsLoading) {
                vid._hlsLoading = true;
                const url = `${CF_BASE}${v._id}.m3u8`;
                if (Hls.isSupported()) {
                    // FIX: optimal config — fast start, low buffer, no wasted data
                    const h = new Hls({
                        startLevel: 0,
                        maxBufferLength: 6,
                        maxMaxBufferLength: 12,
                        abrEwmaDefaultEstimate: 300000,
                        capLevelToPlayerSize: true,
                        enableWorker: true,
                        lowLatencyMode: true,
                        backBufferLength: 0,
                        autoStartLoad: true,
                        manifestLoadingTimeOut: 5000
                    });
                    shortsHlsMap[i] = h;
                    h.on(Hls.Events.MANIFEST_PARSED, () => {
                        vid._hlsLoading = false;
                        // FIX: try unmuted; fallback to muted if browser blocks autoplay
                        vid.muted = false;
                        vid.play().catch(() => {
                            vid.muted = true;
                            globalMuted = true;
                            vid.play().catch(() => {});
                        });
                    });
                    h.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) {
                            vid._hlsLoading = false;
                            try { h.stopLoad(); h.detachMedia(); h.destroy(); } catch(e) {}
                            delete shortsHlsMap[i];
                            vid.src = `${API_BASE}/stream/${v._id}`;
                            vid.load();
                            vid.muted = globalMuted;
                            vid.play().catch(() => {});
                        }
                    });
                    h.loadSource(url);
                    h.attachMedia(vid);
                } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
                    vid._hlsLoading = false;
                    vid.src = url;
                    vid.load();
                    vid.muted = false;
                    vid.play().catch(() => { vid.muted = true; globalMuted = true; vid.play().catch(() => {}); });
                } else {
                    vid._hlsLoading = false;
                    vid.src = `${API_BASE}/stream/${v._id}`;
                    vid.load();
                    vid.muted = globalMuted;
                    vid.play().catch(() => {});
                }
            } else if (!vid._hlsLoading) {
                vid.muted = globalMuted;
                vid.play().catch(() => {});
            }

            // FIX: global video lock — mark this as the only active video
            setActiveVideo(vid);
            vid.muted = globalMuted;
            updateShortProgress(vid, i);

            const hint = document.getElementById(`mute-hint-${i}`);
            if (hint) hint.style.display = globalMuted ? 'flex' : 'none';

            // Track view — prevent spam on rapid scroll
            if (!watchedShortIds.includes(v._id)) {
                watchedShortIds.push(v._id);
                const initData = window.Telegram?.WebApp?.initData || "";
                fetch(`${API_BASE}/views/${v._id}`, { method: 'POST', headers: { 'x-telegram-init-data': initData } }).catch(() => {});
            }

        } else {
            // FIX: offscreen — destroy ALL HLS immediately (no ±3 threshold), pause, clear src
            vid.pause();
            vid.currentTime = 0;

            if (shortsHlsMap[i]) {
                try { shortsHlsMap[i].stopLoad(); shortsHlsMap[i].destroy(); } catch(e) {}
                delete shortsHlsMap[i];
            }
            vid._hlsLoading = false;
            vid.removeAttribute('src');
            vid.load();
        }
    });

    // FIX: safe preload — load next manifest only, autoStartLoad:false = no buffering/playback
    const nextIdx = idx + 1;
    const preKey = `pre_${nextIdx}`;
    if (nextIdx < currentPlaylist.length && !shortsHlsMap[nextIdx] && !shortsHlsMap[preKey] && Hls.isSupported()) {
        const preloadHls = new Hls({
            autoStartLoad: false, // key: manifest only, no actual download
            startLevel: 0,
            manifestLoadingTimeOut: 5000
        });
        preloadHls.loadSource(`${CF_BASE}${currentPlaylist[nextIdx]._id}.m3u8`);
        // DO NOT attachMedia — keeps it purely as a manifest fetch
        shortsHlsMap[preKey] = preloadHls;
    }
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
    // FIX: full cleanup on close
    cleanupAllVideos();
    destroyAllShortsHls();
    activeVideo = null;
    shortsFeed.innerHTML = "";
    currentPlaylist = [];
}
