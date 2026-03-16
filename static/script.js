const API_BASE = "/api"; 
const PD_PROXY_URL = "/api/pd"; 
const CF_BASE = "https://minitube-stream.f0471649.workers.dev/playlist/";
const MY_ADMIN_ID = "1326069145"; 

let allVideos = [];
let shortsVideos = [];
let longVideos = [];
let hlsPlayer = null; // HLS.js instance
let plyrPlayer = null; // Plyr instance

// DOM Elements
const mainContent = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");
const videoOverlay = document.getElementById("video-player-overlay");
const shortsOverlay = document.getElementById("shorts-fullscreen-container"); // Existing ID
const shortsFeed = document.getElementById("shorts-wrapper"); // Existing ID

/* =======================================
   1. INITIALIZATION & TELEGRAM LOGIC
======================================= */
window.addEventListener("DOMContentLoaded", async () => {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready(); 
            window.Telegram.WebApp.expand(); 
            const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
            if (tgUser && String(tgUser.id) === MY_ADMIN_ID) {
                const adminBtn = document.getElementById("adminNavBtn");
                if(adminBtn) adminBtn.classList.remove("hidden");
            }
        }
    } catch(e) { console.log("Web mode active"); }

    // Enter Key Search Support
    const searchInput = document.getElementById("searchInput");
    if(searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") searchVideos();
        });
    }

    // Keyboard Support for Long Player
    window.addEventListener("keydown", (e) => {
        if (videoOverlay && !videoOverlay.classList.contains("hidden")) {
            if (e.code === "Escape") closePlayer();
        }
    });

    await fetchAllVideos();
    loadHome();
    setupShortsTouchEngine(); // Swipe logic initialize
});

async function fetchAllVideos() {
    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        const res = await fetch(`${API_BASE}/videos/recommended`, {
            headers: { 'x-telegram-init-data': initData }
        });
        allVideos = await res.json();
        shortsVideos = allVideos.filter(v => v.type === "short");
        longVideos = allVideos.filter(v => v.type === "long" || v.type === "hls_movie");
    } catch (e) { console.error("Fetch Error:", e); }
}

async function searchVideos() {
    const query = document.getElementById("searchInput").value.trim();
    if (!query) {
        loadHome();
        return;
    }

    setActiveNav(-1); 
    mainContent.innerHTML = `
        <div class="section-loader">
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>Searching...</span>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/videos/search?q=${encodeURIComponent(query)}`);
        const searchResults = await res.json();
        
        mainContent.innerHTML = `<h2 class="section-header">Results for "${query}"</h2>`;
        
        if (searchResults.length === 0) {
            mainContent.innerHTML += `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No videos found</p>
                    <span>Try searching for something else</span>
                </div>
            `;
            return;
        }

        searchResults.forEach(video => {
            const isShort = video.type === 'short';
            mainContent.innerHTML += `
                <div class="long-video-card" onclick="${!isShort ? `openLongPlayer('${video._id}')` : `openShortsPlayer('${video._id}')`}">
                    <div class="thumbnail-container">
                        <img src="${PD_PROXY_URL}/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                    </div>
                    <div class="video-info">
                        <h3>${video.title}</h3>
                        <p>${video.view_count || 0} views • ${isShort ? 'Short' : 'Video'}</p>
                    </div>
                </div>
            `;
        });
    } catch (e) {
        mainContent.innerHTML = "<div style='text-align:center; padding:20px;'>Search failed.</div>";
    }
}

function setActiveNav(index) {
    bottomNavItems.forEach((item, i) => {
        item.classList.toggle("active", i === index);
    });
}

/* =======================================
   2. FEED RENDERING (HOME & NEW)
======================================= */
function renderFeed(vList, emptyMsg = "No videos found") {
    mainContent.innerHTML = "";
    if (vList.length === 0) {
        mainContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clock"></i>
                <p>${emptyMsg}</p>
            </div>
        `;
        return;
    }

    for (let i = 0; i < vList.length; i++) {
        let v = vList[i];
        
        if (v.type === "long" || v.type === "hls_movie") {
            mainContent.innerHTML += `
                <div class="video-card" onclick="openLongPlayer('${v._id}')">
                    <img class="thumbnail" src="${PD_PROXY_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                    <div class="card-info">
                        <div class="v-title">${v.title}</div>
                        <div class="v-meta">${v.view_count || 0} views • Video</div>
                    </div>
                </div>
            `;
        } else {
            let shortsGroup = [v];
            while (i + 1 < vList.length && vList[i+1].type === "short" && shortsGroup.length < 4) {
                i++;
                shortsGroup.push(vList[i]);
            }
            
            mainContent.innerHTML += `
                <div class="shorts-shelf">
                    <div class="shorts-shelf-title"><i class="fas fa-sync-alt"></i> Scrolls</div>
                    <div class="shorts-grid">
                        ${shortsGroup.map((short) => `
                            <div class="short-card-home" onclick="openShortsPlayer('${short._id}')">
                                <img src="${PD_PROXY_URL}/${short.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/200x350?text=Short'">
                                <div class="title">${short.title}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }
}

function loadHome() { setActiveNav(0); renderFeed(allVideos); }

function loadNewTab() {
    setActiveNav(1);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const newVideos = allVideos.filter(v => new Date(v.created_at) >= sevenDaysAgo);
    renderFeed(newVideos, "No new videos in the last 7 days");
}

function loadShortsTab() {
    setActiveNav(2);
    openShortsPlayer(shortsVideos[0]?._id);
}

/* =======================================
   3. CATEGORY LAYOUT
======================================= */
async function loadCategoriesTab() {
    setActiveNav(3);
    mainContent.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i><span>Loading Categories...</span></div>`;
    try {
        const catRes = await fetch(`${API_BASE}/categories`);
        const categories = await catRes.json();
        mainContent.innerHTML = "";
        for (let cat of categories) {
            const catVideos = allVideos.filter(v => v.category_id === cat._id);
            if(catVideos.length === 0) continue;
            const top5 = catVideos.slice(0, 5);
            mainContent.innerHTML += `
                <div class="category-section">
                    <div class="category-header"><h2>${cat.name}</h2><span class="view-all" onclick="viewAllCategory('${cat._id}', '${cat.name}')">View All</span></div>
                    <div class="category-horizontal-scroll">
                        ${top5.map(v => `
                            <div class="category-video-card" onclick="${v.type !== 'short' ? `openLongPlayer('${v._id}')` : `openShortsPlayer('${v._id}')`}">
                                <div class="thumbnail-container"><img src="${PD_PROXY_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/320x180'"></div>
                                <div class="video-info"><h3 style="font-size:12px;">${v.title}</h3></div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
        }
    } catch (e) { mainContent.innerHTML = "<div style='text-align:center; padding:20px;'>Error loading categories</div>"; }
}

function viewAllCategory(catId, catName) {
    const catVideos = allVideos.filter(v => v.category_id === catId);
    mainContent.innerHTML = `<h2 class="section-header"><i class="fas fa-arrow-left" onclick="loadCategoriesTab()"></i> ${catName}</h2>`;
    catVideos.forEach(v => {
        const isShort = v.type === 'short';
        mainContent.innerHTML += `
            <div class="long-video-card" onclick="${!isShort ? `openLongPlayer('${v._id}')` : `openShortsPlayer('${v._id}')`}">
                <div class="thumbnail-container"><img src="${PD_PROXY_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'"></div>
                <div class="video-info"><h3>${v.title}</h3><p>${v.view_count || 0} views</p></div>
            </div>`;
    });
}

/* =======================================
   4. PREMIUM LONG PLAYER (PLYR + HLS)
======================================= */
function openLongPlayer(videoId) {
    const vData = allVideos.find(v => v._id === videoId);
    if(!vData) return;

    videoOverlay.classList.remove("hidden"); // Old class
    videoOverlay.classList.add("active"); // New class
    videoOverlay.scrollTo(0, 0);

    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";

    const videoElement = document.getElementById("longVideoPlayer");
    const hlsUrl = `${CF_BASE}${videoId}.m3u8`;

    if (plyrPlayer) plyrPlayer.destroy();
    if (hlsPlayer) hlsPlayer.destroy();

    plyrPlayer = new Plyr(videoElement, {
        controls: ['play-large', 'play', 'rewind', 'fast-forward', 'progress', 'current-time', 'mute', 'settings', 'pip', 'fullscreen'],
        settings: ['speed']
    });

    if (Hls.isSupported()) {
        hlsPlayer = new Hls();
        hlsPlayer.loadSource(hlsUrl);
        hlsPlayer.attachMedia(videoElement);
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => videoElement.play().catch(() => {}));
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = hlsUrl;
    } else {
        videoElement.src = `${API_BASE}/stream/${videoId}`;
    }

    const initData = window.Telegram?.WebApp?.initData || "";
    fetch(`${API_BASE}/views/${videoId}`, { method: 'POST', headers: { 'x-telegram-init-data': initData } });
    loadRelatedVideos(videoId);
}

function closePlayer() {
    videoOverlay.classList.add("hidden");
    videoOverlay.classList.remove("active");
    if (plyrPlayer) plyrPlayer.destroy();
    if (hlsPlayer) hlsPlayer.destroy();
}

async function loadRelatedVideos(currentVideoId) {
    const container = document.getElementById("related-videos-container");
    container.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i></div>`;
    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        const res = await fetch(`${API_BASE}/videos/recommended?current_video_id=${currentVideoId}&type=long`, {
            headers: { 'x-telegram-init-data': initData }
        });
        const related = await res.json();
        container.innerHTML = "";
        related.slice(0, 15).forEach(v => {
            container.innerHTML += `
                <div class="long-video-card" onclick="openLongPlayer('${v._id}')" style="margin-bottom:15px; display:flex; gap:10px;">
                    <div class="thumbnail-container" style="flex:0 0 140px; height:80px; border-radius:8px; overflow:hidden;"><img src="${PD_PROXY_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/140x80'"></div>
                    <div class="video-info" style="padding:0; flex:1;"><h3 style="font-size:13px; -webkit-line-clamp:2; margin-bottom:5px;">${v.title}</h3><p style="font-size:11px;">${v.view_count || 0} views</p></div>
                </div>`;
        });
    } catch(e) { container.innerHTML = ""; }
}

/* =======================================
   5. SHORTS ENGINE (TRUE SWIPE LOGIC)
======================================= */
let currentShortIdx = 0;
let startY = 0;
let isDragging = false;
let globalMuted = true;
let lastTapTime = 0;

function openShortsPlayer(targetId = null) {
    shortsOverlay.classList.remove("hidden");
    shortsOverlay.style.display = "block";
    shortsFeed.innerHTML = "";

    shortsVideos.forEach((v, i) => {
        const reel = document.createElement("div");
        reel.className = "short-player-item"; // Use existing CSS class if possible
        reel.style.height = "100vh";
        reel.style.width = "100%";
        reel.style.position = "relative";
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted style="width:100%; height:100%; object-fit:cover;"></video>
            <div class="short-info-overlay" style="position:absolute; bottom:80px; left:15px; pointer-events:none;">
                <b style="font-size:16px;">${v.title}</b>
            </div>
            <div style="position:absolute; bottom:0; left:0; width:100%; height:3px; background:rgba(255,255,255,0.2);">
                <div id="short-progress-${i}" style="height:100%; width:0%; background:var(--primary); box-shadow:0 0 10px var(--primary);"></div>
            </div>
        `;
        shortsFeed.appendChild(reel);
    });

    if(targetId) currentShortIdx = shortsVideos.findIndex(v => v._id === targetId);
    else currentShortIdx = 0;
    
    snapToShort(currentShortIdx);
}

function setupShortsTouchEngine() {
    if(!shortsOverlay) return;
    shortsOverlay.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        isDragging = true;
        shortsFeed.style.transition = "none";
    }, {passive: true});

    shortsOverlay.addEventListener('touchmove', e => {
        if(!isDragging) return;
        let deltaY = e.touches[0].clientY - startY;
        shortsFeed.style.transform = `translateY(calc(-${currentShortIdx * 100}vh + ${deltaY}px))`;
    }, {passive: true});

    shortsOverlay.addEventListener('touchend', e => {
        isDragging = false;
        let deltaY = e.changedTouches[0].clientY - startY;
        
        let now = new Date().getTime();
        let timesince = now - lastTapTime;
        
        if (Math.abs(deltaY) < 10) {
            if (timesince < 300) { handleShortDoubleTap(); } 
            else { handleShortTap(); }
            lastTapTime = now;
        } 
        else if (deltaY < -50 && currentShortIdx < shortsVideos.length - 1) { currentShortIdx++; }
        else if (deltaY > 50 && currentShortIdx > 0) { currentShortIdx--; }
        
        snapToShort(currentShortIdx);
    });
}

function snapToShort(idx) {
    shortsFeed.style.transition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
    shortsFeed.style.transform = `translateY(-${idx * 100}vh)`;
    
    shortsVideos.forEach((v, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if(!vid) return;
        if(i === idx) {
            if(!vid.src) {
                const hlsUrl = `${CF_BASE}${v._id}.m3u8`;
                if (Hls.isSupported()) {
                    let h = new Hls(); h.loadSource(hlsUrl); h.attachMedia(vid);
                } else {
                    vid.src = hlsUrl;
                }
            }
            vid.muted = globalMuted;
            vid.play().catch(() => {});
            updateShortProgress(vid, i);
            fetch(`${API_BASE}/views/${v._id}`, { method: 'POST' });
        } else {
            vid.pause();
            vid.currentTime = 0;
        }
    });
}

function updateShortProgress(vid, i) {
    vid.ontimeupdate = () => {
        const bar = document.getElementById(`short-progress-${i}`);
        if(bar) bar.style.width = (vid.currentTime / vid.duration) * 100 + "%";
    };
}

function handleShortTap() {
    const vid = document.getElementById(`short-vid-${currentShortIdx}`);
    if(!vid) return;
    globalMuted = !globalMuted;
    vid.muted = globalMuted;
}

function handleShortDoubleTap() {
    const vid = document.getElementById(`short-vid-${currentShortIdx}`);
    if(!vid) return;
    if (vid.paused) vid.play(); else vid.pause();
}

function closeShorts() {
    shortsOverlay.classList.add("hidden");
    shortsOverlay.style.display = "none";
    shortsVideos.forEach((v, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if(vid) { vid.pause(); vid.src = ""; }
    });
}
