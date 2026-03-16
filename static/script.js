const API_BASE = "/api"; 
const PD_PROXY_URL = "/api/pd"; 
const CF_BASE = "https://minitube-stream.f0471649.workers.dev/playlist/";
const MY_ADMIN_ID = "1326069145"; 

let allVideos = [];
let shortsVideos = [];
let hlsPlayer = null; // HLS.js instance
let plyrPlayer = null; // Plyr instance

// DOM Elements
const mainContent = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");
const videoOverlay = document.getElementById("video-player-overlay");
const shortsOverlay = document.getElementById("shorts-overlay");
const shortsFeed = document.getElementById("shorts-feed");

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
                document.getElementById("adminNavBtn").classList.remove("hidden");
            }
        }
    } catch(e) { console.log("Web mode active"); }

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
    } catch (e) { console.error("Fetch Error:", e); }
}

/* =======================================
   2. FEED RENDERING (YELLOW GLOW LOOK)
======================================= */
function renderFeed(vList) {
    mainContent.innerHTML = "";
    vList.forEach(v => {
        const isShort = v.type === "short";
        const card = document.createElement("div");
        card.className = "video-card";
        card.onclick = () => isShort ? openShortsTab(v._id) : openLongPlayer(v._id);
        
        card.innerHTML = `
            <img class="thumbnail" src="${PD_PROXY_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
            <div class="card-info">
                <div class="v-title">${v.title}</div>
                <div class="v-meta">${v.view_count || 0} views • ${isShort ? 'Scroll' : 'Video'}</div>
            </div>
        `;
        mainContent.appendChild(card);
    });
}

function loadHome() { setActiveNav(0); renderFeed(allVideos); }
function setActiveNav(index) {
    bottomNavItems.forEach((item, i) => {
        item.classList.toggle("active", i === index);
    });
}

/* =======================================
   3. PREMIUM LONG PLAYER (PLYR + HLS)
======================================= */
function openLongPlayer(videoId) {
    const vData = allVideos.find(v => v._id === videoId);
    if(!vData) return;

    videoOverlay.classList.add("active");
    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";

    const video = document.getElementById("longVideoPlayer");
    const hlsUrl = `${CF_BASE}${videoId}.m3u8`;

    // Reset Plyr & HLS
    if (plyrPlayer) plyrPlayer.destroy();
    if (hlsPlayer) hlsPlayer.destroy();

    // Plyr Options (Only Mute, 10s Skip)
    plyrPlayer = new Plyr(video, {
        controls: ['play-large', 'play', 'rewind', 'fast-forward', 'progress', 'current-time', 'mute', 'settings', 'pip', 'fullscreen'],
        settings: ['speed']
    });

    if (Hls.isSupported()) {
        hlsPlayer = new Hls();
        hlsPlayer.loadSource(hlsUrl);
        hlsPlayer.attachMedia(video);
        hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => video.play());
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
    }

    // View Count Update
    fetch(`${API_BASE}/views/${videoId}`, { method: 'POST' });
    loadRelatedVideos(videoId);
}

function closePlayer() {
    videoOverlay.classList.remove("active");
    if (plyrPlayer) plyrPlayer.stop();
    if (hlsPlayer) hlsPlayer.destroy();
}

/* =======================================
   4. SHORTS ENGINE (TRUE SWIPE LOGIC)
======================================= */
let currentShortIdx = 0;
let startY = 0;
let isDragging = false;
let globalMuted = true;

function loadShortsTab(targetId = null) {
    setActiveNav(2);
    shortsOverlay.style.display = "block";
    shortsFeed.innerHTML = "";

    shortsVideos.forEach((v, i) => {
        const reel = document.createElement("div");
        reel.className = "short-reel";
        reel.innerHTML = `
            <video id="short-vid-${i}" loop playsinline muted style="width:100%; height:100%; object-fit:cover;"></video>
            <div style="position:absolute; bottom:80px; left:15px; pointer-events:none;">
                <b style="font-size:16px;">${v.title}</b>
            </div>
            <div style="position:absolute; bottom:0; left:0; width:100%; height:3px; background:rgba(255,255,255,0.2);">
                <div id="short-progress-${i}" style="height:100%; width:0%; background:var(--primary); box-shadow:0 0 10px var(--primary);"></div>
            </div>
        `;
        shortsFeed.appendChild(reel);
    });

    if(targetId) currentShortIdx = shortsVideos.findIndex(v => v._id === targetId);
    snapToShort(currentShortIdx);
}

function setupShortsTouchEngine() {
    shortsOverlay.addEventListener('touchstart', e => {
        startY = e.touches[0].clientY;
        isDragging = true;
        shortsFeed.style.transition = "none";
    });

    shortsOverlay.addEventListener('touchmove', e => {
        if(!isDragging) return;
        let deltaY = e.touches[0].clientY - startY;
        shortsFeed.style.transform = `translateY(calc(-${currentShortIdx * 100}vh + ${deltaY}px))`;
    });

    shortsOverlay.addEventListener('touchend', e => {
        isDragging = false;
        let deltaY = e.changedTouches[0].clientY - startY;
        
        if (Math.abs(deltaY) < 10) { handleShortTap(); } // Click detect
        else if (deltaY < -50 && currentShortIdx < shortsVideos.length - 1) { currentShortIdx++; }
        else if (deltaY > 50 && currentShortIdx > 0) { currentShortIdx--; }
        
        snapToShort(currentShortIdx);
    });
}

function snapToShort(idx) {
    shortsFeed.style.transition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
    shortsFeed.style.transform = `translateY(-${idx * 100}vh)`;
    
    // Play active, pause others
    shortsVideos.forEach((v, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if(i === idx) {
            if(!vid.src) vid.src = `${CF_BASE}${v._id}.m3u8`;
            if (Hls.isSupported()) {
                let h = new Hls(); h.loadSource(vid.src); h.attachMedia(vid);
            }
            vid.muted = globalMuted;
            vid.play();
            updateShortProgress(vid, i);
        } else if(vid) {
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
    globalMuted = !globalMuted;
    vid.muted = globalMuted;
}

function closeShorts() {
    shortsOverlay.style.display = "none";
    shortsVideos.forEach((v, i) => {
        const vid = document.getElementById(`short-vid-${i}`);
        if(vid) { vid.pause(); vid.src = ""; }
    });
}
