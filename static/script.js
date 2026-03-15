const API_BASE = "/api"; 
const CF_WORKER_URL = "https://minitube-stream.f0471649.workers.dev";
const MY_ADMIN_ID = 1326069145; // Aapka Admin ID

let allVideos = [];
let shortsVideos = [];
let longVideos = [];

// DOM Elements
const mainContent = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");

// On Load
window.addEventListener("DOMContentLoaded", async () => {
    
    // --- ADMIN BUTTON LOGIC ---
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready(); 
            window.Telegram.WebApp.expand(); // Ensure it fills the screen
            const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
            if (tgUser && tgUser.id == MY_ADMIN_ID) {
                const adminBtn = document.getElementById("adminNavBtn");
                if(adminBtn) adminBtn.classList.remove("hidden");
            }
        }
    } catch(e) {
        console.log("Not running inside Telegram");
    }

    // Enter Key Search Support
    const searchInput = document.getElementById("searchInput");
    if(searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") searchVideos();
        });
    }

    // Keyboard Support for Long Player
    window.addEventListener("keydown", (e) => {
        if (!videoOverlay.classList.contains("hidden")) {
            if (e.code === "Space") {
                e.preventDefault();
                togglePlayPause();
            }
            if (e.code === "ArrowRight") video.currentTime += 10;
            if (e.code === "ArrowLeft") video.currentTime -= 10;
            if (e.code === "Escape") closePlayer();
        }
    });

    await fetchAllVideos();
    loadHome();
});

// Fetch Data
async function fetchAllVideos() {
    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        const res = await fetch(`${API_BASE}/videos/recommended`, {
            headers: { 'x-telegram-init-data': initData }
        });
        allVideos = await res.json();
        shortsVideos = allVideos.filter(v => v.type === "short");
        longVideos = allVideos.filter(v => v.type === "long");
    } catch (e) {
        console.error("Error fetching videos:", e);
    }
}

async function searchVideos() {
    const query = document.getElementById("searchInput").value.trim();
    if (!query) {
        loadHome();
        return;
    }

    setActiveNav(-1); // Deactivate all nav items
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
            mainContent.innerHTML += `
                <div class="long-video-card" onclick="${video.type === 'long' ? `openLongPlayer('${video._id}')` : `openShortsPlayer('${video._id}')`}">
                    <div class="thumbnail-container">
                        <img src="${CF_WORKER_URL}/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                    </div>
                    <div class="video-info">
                        <h3>${video.title}</h3>
                        <p>${video.view_count || 0} views • ${video.type === 'short' ? 'Short' : 'Video'}</p>
                    </div>
                </div>
            `;
        });
    } catch (e) {
        mainContent.innerHTML = "<div style='text-align:center; padding:20px;'>Search failed.</div>";
    }
}

function setActiveNav(index) {
    bottomNavItems.forEach(item => item.classList.remove("active"));
    if(index >= 0) bottomNavItems[index].classList.add("active");
}

/* =======================================
   FEED RENDERING (HOME & NEW)
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
        
        if (v.type === "long") {
            mainContent.innerHTML += `
                <div class="long-video-card" onclick="openLongPlayer('${v._id}')">
                    <div class="thumbnail-container">
                        <img src="${CF_WORKER_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                    </div>
                    <div class="video-info">
                        <h3>${v.title}</h3>
                        <p>${v.view_count || 0} views</p>
                    </div>
                </div>
            `;
        } else {
            // Consecutive Shorts Grouping (up to 4)
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
                                <img src="${CF_WORKER_URL}/${short.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/200x350?text=Short'">
                                <div class="title">${short.title}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }
}

function loadHome() {
    setActiveNav(0);
    renderFeed(allVideos);
}

function loadNewTab() {
    setActiveNav(1);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const newVideos = allVideos.filter(v => {
        const createdDate = new Date(v.created_at);
        return createdDate >= sevenDaysAgo;
    });
    
    renderFeed(newVideos, "No new videos in the last 7 days");
}

function loadShortsTab() {
    setActiveNav(2);
    openShortsPlayer(shortsVideos[0]?._id);
}

/* =======================================
   CATEGORY LAYOUT
======================================= */
async function loadCategoriesTab() {
    setActiveNav(3);
    mainContent.innerHTML = `
        <div class="section-loader">
            <i class="fas fa-circle-notch fa-spin"></i>
            <span>Loading Categories...</span>
        </div>
    `;
    
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
                    <div class="category-header">
                        <h2>${cat.name}</h2>
                        <span class="view-all" onclick="viewAllCategory('${cat._id}', '${cat.name}')">View All</span>
                    </div>
                    <div class="category-horizontal-scroll">
                        ${top5.map(v => `
                            <div class="category-video-card" onclick="${v.type === 'long' ? `openLongPlayer('${v._id}')` : `openShortsPlayer('${v._id}')`}">
                                <div class="thumbnail-container">
                                    <img src="${CF_WORKER_URL}/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/320x180'">
                                </div>
                                <div class="video-info">
                                    <h3 style="font-size:12px;">${v.title}</h3>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    } catch (e) {
        mainContent.innerHTML = "<div style='text-align:center; padding:20px;'>Error loading categories</div>";
    }
}

function viewAllCategory(catId, catName) {
    const catVideos = allVideos.filter(v => v.category_id === catId);
    mainContent.innerHTML = `
        <h2 class="section-header"><i class="fas fa-arrow-left" onclick="loadCategoriesTab()"></i> ${catName}</h2>
    `;
    catVideos.forEach(video => {
        mainContent.innerHTML += `
            <div class="long-video-card" onclick="${video.type === 'long' ? `openLongPlayer('${video._id}')` : `openShortsPlayer('${video._id}')`}">
                <div class="thumbnail-container">
                    <img src="${CF_WORKER_URL}/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                </div>
                <div class="video-info">
                    <h3>${video.title}</h3>
                    <p>${video.view_count || 0} views</p>
                </div>
            </div>
        `;
    });
}

/* =======================================
   SHORTS PLAYER & PRELOAD
======================================= */
const shortsContainer = document.getElementById("shorts-fullscreen-container");
const shortsWrapper = document.getElementById("shorts-wrapper");
let shortsObserver;

function openShortsPlayer(targetVideoId = null) {
    shortsContainer.classList.remove("hidden");
    
    // Use the current shortsVideos order (Stable)
    shortsWrapper.innerHTML = "";
    shortsVideos.forEach((short, index) => {
        shortsWrapper.innerHTML += `
            <div class="short-player-item" data-index="${index}" data-id="${short._id}">
                <video id="short-vid-${index}" loop playsinline preload="none"></video>
                <div class="shorts-play-pause-overlay" id="shorts-btn-${index}">
                    <i class="fas fa-play"></i>
                </div>
                <div class="short-info-overlay">
                    <h3>${short.title}</h3>
                </div>
            </div>
        `;
    });

    document.querySelectorAll('.short-player-item').forEach(item => {
        let lastShortTap = 0;
        const index = item.getAttribute('data-index');
        const overlay = document.getElementById(`shorts-btn-${index}`);
        const vid = item.querySelector('video');

        item.addEventListener('click', (e) => {
            let now = new Date().getTime();
            let delta = now - lastShortTap;
            if (delta < 300 && delta > 0) {
                toggleShortPlay(vid, overlay);
            }
            lastShortTap = now;
        });
    });

    const options = { root: shortsWrapper, threshold: 0.7 };
    if(shortsObserver) shortsObserver.disconnect();

    shortsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = parseInt(entry.target.getAttribute('data-index'));
            const vid = document.getElementById(`short-vid-${index}`);
            
            if (entry.isIntersecting) {
                if(!vid.src) {
                    const video = shortsVideos[index];
                    vid.src = video.pixeldrain_id ? `${CF_WORKER_URL}/${video.pixeldrain_id}` : `${API_BASE}/stream/${video._id}`;
                }
                vid.play().catch(e => console.log("Auto-play prevented"));
                
                fetch(`${API_BASE}/views/${shortsVideos[index]._id}`, { method: 'POST' });

                for(let i = 1; i <= 2; i++) {
                    if(index + i < shortsVideos.length) {
                        const nextVid = document.getElementById(`short-vid-${index + i}`);
                        if(!nextVid.src) {
                            const nextV = shortsVideos[index + i];
                            nextVid.src = nextV.pixeldrain_id ? `${CF_WORKER_URL}/${nextV.pixeldrain_id}` : `${API_BASE}/stream/${nextV._id}`;
                            nextVid.preload = "auto";
                        }
                    }
                }
            } else {
                vid.pause();
                vid.currentTime = 0;
                const overlay = document.getElementById(`shorts-btn-${index}`);
                if(overlay) overlay.classList.remove('show');
            }
        });
    }, options);

    document.querySelectorAll('.short-player-item').forEach(item => {
        shortsObserver.observe(item);
    });

    setTimeout(() => {
        let finalIdx = 0;
        if (targetVideoId) {
            finalIdx = shortsVideos.findIndex(v => v._id === targetVideoId);
        }
        const targetElement = document.querySelector(`.short-player-item[data-index="${finalIdx >= 0 ? finalIdx : 0}"]`);
        if(targetElement) targetElement.scrollIntoView();
    }, 100);
}

function toggleShortPlay(vid, overlay) {
    if (vid.paused) {
        vid.play();
        overlay.classList.remove('show');
    } else {
        vid.pause();
        overlay.classList.add('show');
    }
}

function closeShorts() {
    shortsContainer.classList.add("hidden");
    if(shortsObserver) shortsObserver.disconnect();
    shortsWrapper.innerHTML = "";
}

/* =======================================
   LONG VIDEO PLAYER
======================================= */
const videoOverlay = document.getElementById("video-player-overlay");
const playerContainer = document.getElementById("playerContainer");
const video = document.getElementById("longVideoPlayer");
const playPauseBtn = document.getElementById("playPauseBtn");
const muteBtn = document.getElementById("muteBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const progressBar = document.getElementById("progressBar");
const bufferBar = document.getElementById("bufferBar");
const progressContainer = document.getElementById("progressContainer");
const timeDisplay = document.getElementById("timeDisplay");
const playerControls = document.getElementById("playerControls");
const loadingSpinner = document.getElementById("loadingSpinner");
const rewindInd = document.getElementById("rewindIndicator");
const forwardInd = document.getElementById("forwardIndicator");

let controlsTimeout;
let lastTap = 0;
function openLongPlayer(videoId) {
    const vData = allVideos.find(v => v._id === videoId);
    if(!vData) return;

    videoOverlay.classList.remove("hidden");
    videoOverlay.scrollTo(0, 0); // Reset scroll to top
    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";

    // Reset Player UI for a fresh look
    video.pause();
    video.currentTime = 0;
    progressBar.style.width = "0%";
    bufferBar.style.width = "0%";
    timeDisplay.innerText = "0:00 / 0:00";
    loadingSpinner.classList.remove('hidden');

    video.src = vData.pixeldrain_id ? `${CF_WORKER_URL}/${vData.pixeldrain_id}` : `${API_BASE}/stream/${videoId}`;
    video.load();
    video.play();
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';

    const initData = window.Telegram?.WebApp?.initData || "";
    fetch(`${API_BASE}/views/${videoId}`, { 
        method: 'POST',
        headers: { 'x-telegram-init-data': initData }
    });

    resetControlsTimeout();
    loadRelatedVideos(videoId);
}

async function loadRelatedVideos(currentVideoId) {
    const container = document.getElementById("related-videos-container");
    container.innerHTML = `<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i></div>`;

    try {
        const initData = window.Telegram?.WebApp?.initData || "";
        // Fetch only LONG videos for recommendations
        const res = await fetch(`${API_BASE}/videos/recommended?current_video_id=${currentVideoId}&type=long`, {
            headers: { 'x-telegram-init-data': initData }
        });
        const related = await res.json();
        container.innerHTML = "";

        related.slice(0, 15).forEach(video => {
            container.innerHTML += `
                <div class="long-video-card" onclick="openLongPlayer('${video._id}')" style="margin-bottom:15px; display:flex; gap:10px;">
                    <div class="thumbnail-container" style="flex:0 0 140px; height:80px; border-radius:8px; overflow:hidden;">
                        <img src="${CF_WORKER_URL}/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/140x80'">
                    </div>
                    <div class="video-info" style="padding:0; flex:1;">
                        <h3 style="font-size:13px; -webkit-line-clamp:2; margin-bottom:5px;">${video.title}</h3>
                        <p style="font-size:11px;">${video.view_count || 0} views</p>
                    </div>
                </div>
            `;
        });
    } catch(e) { container.innerHTML = ""; }
}


function closePlayer() {
    videoOverlay.classList.add("hidden");
    video.pause();
    video.src = "";
    if (document.fullscreenElement) { document.exitFullscreen(); }
}

function toggleControls() {
    if (playerControls.classList.contains("hide")) {
        playerControls.classList.remove("hide");
        resetControlsTimeout();
    } else {
        playerControls.classList.add("hide");
    }
}

function resetControlsTimeout() {
    clearTimeout(controlsTimeout);
    playerControls.classList.remove("hide");
    if (!video.paused) {
        controlsTimeout = setTimeout(() => {
            playerControls.classList.add("hide");
        }, 3000);
    }
}

function togglePlayPause() {
    if (video.paused) {
        video.play();
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        resetControlsTimeout();
    } else {
        video.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        clearTimeout(controlsTimeout);
        playerControls.classList.remove("hide");
    }
}

playerContainer.addEventListener('click', (e) => {
    if(e.target.closest('.controls-bottom') || e.target.closest('.close-player-btn')) return;

    let currentTime = new Date().getTime();
    let tapGap = currentTime - lastTap;
    
    if (tapGap < 300 && tapGap > 0) {
        clearTimeout(controlsTimeout);
        let rect = playerContainer.getBoundingClientRect();
        let tapX = e.clientX - rect.left;
        
        if (tapX < rect.width / 2) {
            video.currentTime -= 10;
            rewindInd.classList.add('show');
            setTimeout(() => rewindInd.classList.remove('show'), 500);
        } else {
            video.currentTime += 10;
            forwardInd.classList.add('show');
            setTimeout(() => forwardInd.classList.remove('show'), 500);
        }
    } else {
        toggleControls();
    }
    lastTap = currentTime;
});

video.addEventListener('ended', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    playerControls.classList.remove("hide");
    clearTimeout(controlsTimeout);
});

video.addEventListener('waiting', () => { loadingSpinner.classList.remove('hidden'); });
video.addEventListener('playing', () => { loadingSpinner.classList.add('hidden'); });
video.addEventListener('canplay', () => { loadingSpinner.classList.add('hidden'); });

video.addEventListener("timeupdate", () => {
    if (!video.duration) return;
    const progress = (video.currentTime / video.duration) * 100;
    progressBar.style.width = `${progress}%`;
    let curMins = Math.floor(video.currentTime / 60);
    let curSecs = Math.floor(video.currentTime % 60).toString().padStart(2, '0');
    let durMins = Math.floor(video.duration / 60);
    let durSecs = Math.floor(video.duration % 60).toString().padStart(2, '0');
    timeDisplay.innerText = `${curMins}:${curSecs} / ${durMins}:${durSecs}`;
});

video.addEventListener('progress', () => {
    if (video.duration > 0 && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferProgress = (bufferedEnd / video.duration) * 100;
        bufferBar.style.width = `${bufferProgress}%`;
    }
});

progressContainer.addEventListener("click", (e) => {
    const width = progressContainer.clientWidth;
    const clickX = e.offsetX;
    const duration = video.duration;
    video.currentTime = (clickX / width) * duration;
    resetControlsTimeout();
});

playPauseBtn.addEventListener("click", togglePlayPause);
muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    resetControlsTimeout();
});

fullscreenBtn.addEventListener("click", async () => {
    try {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // SOLUTION B: If on mobile/Telegram, use the Native System Player
        if (isMobile && video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
            return;
        }

        const isFS = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!isFS) {
            const enterFS = playerContainer.requestFullscreen || playerContainer.webkitRequestFullscreen || playerContainer.mozRequestFullScreen || playerContainer.msRequestFullscreen;
            if (enterFS) {
                await enterFS.call(playerContainer);
                fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
                if (screen.orientation && screen.orientation.lock) {
                    await screen.orientation.lock("landscape").catch(e => console.log("Orientation lock blocked"));
                }
            } else if (video.webkitEnterFullscreen) {
                video.webkitEnterFullscreen();
            }
        } else {
            const exitFS = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
            if (exitFS) {
                await exitFS.call(document);
                fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
            }
        }
    } catch (e) {
        console.error("Fullscreen/Rotate Error:", e);
    }
});

const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
fsEvents.forEach(evt => {
    document.addEventListener(evt, () => {
        const isFS = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!isFS) {
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } else {
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        }
    });
});
