const API_BASE = "/api"; 
const MY_ADMIN_ID = 1326069145; // Aapka Admin ID

let allVideos = [];
let shortsVideos = [];
let longVideos = [];
let shortsSortOrder = 'random'; // Default to Random

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
    applyShortsSort('random'); // Initial shuffle
    loadHome();
});

// Fetch Data
async function fetchAllVideos() {
    try {
        const res = await fetch(`${API_BASE}/videos`);
        allVideos = await res.json();
        // Base shorts from allVideos
        shortsVideos = allVideos.filter(v => v.type === "short");
        longVideos = allVideos.filter(v => v.type === "long");
    } catch (e) {
        console.error("Error fetching videos:", e);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function applyShortsSort(order) {
    shortsSortOrder = order;
    
    // Refresh base shorts from allVideos
    let baseShorts = [...allVideos.filter(v => v.type === "short")];
    
    if (order === 'new') {
        shortsVideos = baseShorts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (order === 'old') {
        shortsVideos = baseShorts.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
        shortsVideos = shuffleArray(baseShorts);
    }

    // Update Dots UI
    document.querySelectorAll('.shorts-menu i').forEach(i => i.classList.remove('active'));
    const dot = document.getElementById(`dot-${order}`);
    if(dot) dot.classList.add('active');
}

function toggleShortsMenu() {
    document.getElementById('shorts-sort-menu').classList.toggle('hidden');
}

function setShortsSort(order) {
    applyShortsSort(order);
    toggleShortsMenu();
    
    if (!shortsContainer.classList.contains("hidden")) {
        openShortsPlayer(0);
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
                <div class="long-video-card" onclick="${video.type === 'long' ? `openLongPlayer('${video._id}')` : `openShortsPlayerFromGlobal('${video._id}')`}">
                    <div class="thumbnail-container">
                        <img src="https://pixeldrain.com/api/file/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
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

function openShortsPlayerFromGlobal(videoId) {
    const index = shortsVideos.findIndex(v => v._id === videoId);
    if(index !== -1) {
        openShortsPlayer(index);
    } else {
        // Fallback if not in current global shorts list
        openLongPlayer(videoId);
    }
}

function setActiveNav(index) {
    bottomNavItems.forEach(item => item.classList.remove("active"));
    if(index >= 0) bottomNavItems[index].classList.add("active");
}

/* =======================================
   HOME FEED ALGORITHM
======================================= */
function loadHome() {
    setActiveNav(0);
    mainContent.innerHTML = "";
    
    let sIndex = 0;
    let lIndex = 0;

    while(sIndex < shortsVideos.length || lIndex < longVideos.length) {
        
        // 1. Add 4 Shorts
        if (sIndex < shortsVideos.length) {
            let chunk = shortsVideos.slice(sIndex, sIndex + 4);
            let shortsHTML = `
                <div class="shorts-shelf">
                    <div class="shorts-shelf-title"><i class="fas fa-bolt"></i> Shorts</div>
                    <div class="shorts-grid">
                        ${chunk.map((video, idx) => `
                            <div class="short-card-home" onclick="openShortsPlayer(${sIndex + idx})">
                                <img src="https://pixeldrain.com/api/file/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/200x350?text=Short'">
                                <div class="title">${video.title}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            mainContent.innerHTML += shortsHTML;
            sIndex += 4;
        }

        // 2. Add 5 Long Videos
        if (lIndex < longVideos.length) {
            let chunk = longVideos.slice(lIndex, lIndex + 5);
            let longsHTML = chunk.map(video => `
                <div class="long-video-card" onclick="openLongPlayer('${video._id}')">
                    <div class="thumbnail-container">
                        <img src="https://pixeldrain.com/api/file/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                    </div>
                    <div class="video-info">
                        <h3>${video.title}</h3>
                        <p>${video.view_count || 0} views</p>
                    </div>
                </div>
            `).join('');
            mainContent.innerHTML += longsHTML;
            lIndex += 5;
        }
    }
}

/* =======================================
   CATEGORY LAYOUT
======================================= */
async function loadCategoriesTab() {
    setActiveNav(2);
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
                            <div class="category-video-card" onclick="${v.type === 'long' ? `openLongPlayer('${v._id}')` : `openShortsPlayerByCat('${cat._id}', '${v._id}')`}">
                                <div class="thumbnail-container">
                                    <img src="https://pixeldrain.com/api/file/${v.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/320x180'">
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
            <div class="long-video-card" onclick="${video.type === 'long' ? `openLongPlayer('${video._id}')` : `openShortsPlayerByCat('${catId}', '${video._id}')`}">
                <div class="thumbnail-container">
                    <img src="https://pixeldrain.com/api/file/${video.pixeldrain_id}/thumbnail" onerror="this.src='https://via.placeholder.com/640x360'">
                </div>
                <div class="video-info">
                    <h3>${video.title}</h3>
                    <p>${video.view_count || 0} views</p>
                </div>
            </div>
        `;
    });
}

function loadShortsTab() {
    setActiveNav(1);
    openShortsPlayer(0);
}

/* =======================================
   SHORTS PLAYER & PRELOAD
======================================= */
const shortsContainer = document.getElementById("shorts-fullscreen-container");
const shortsWrapper = document.getElementById("shorts-wrapper");
let shortsObserver;

function openShortsPlayer(startIndex = 0) {
    shortsContainer.classList.remove("hidden");
    shortsWrapper.innerHTML = "";
    
    shortsVideos.forEach((short, index) => {
        shortsWrapper.innerHTML += `
            <div class="short-player-item" data-index="${index}" data-id="${short._id}">
                <video id="short-vid-${index}" loop playsinline preload="none"></video>
                <div class="short-info-overlay">
                    <h3>${short.title}</h3>
                </div>
            </div>
        `;
    });

    // Handle Taps on Shorts (Double tap for Play/Pause)
    document.querySelectorAll('.short-player-item').forEach(item => {
        let lastShortTap = 0;
        item.addEventListener('click', (e) => {
            let now = new Date().getTime();
            let delta = now - lastShortTap;
            if (delta < 300 && delta > 0) {
                // Double tap detected
                const vid = item.querySelector('video');
                if (vid.paused) vid.play();
                else vid.pause();
            }
            lastShortTap = now;
        });
    });

    const options = { root: shortsWrapper, threshold: 0.7 };
    
    shortsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = parseInt(entry.target.getAttribute('data-index'));
            const vid = document.getElementById(`short-vid-${index}`);
            
            if (entry.isIntersecting) {
                if(!vid.src) vid.src = `${API_BASE}/stream/${shortsVideos[index]._id}`;
                vid.play().catch(e => console.log("Auto-play prevented"));
                
                fetch(`${API_BASE}/views/${shortsVideos[index]._id}`, { method: 'POST' });

                for(let i = 1; i <= 2; i++) {
                    if(index + i < shortsVideos.length) {
                        const nextVid = document.getElementById(`short-vid-${index + i}`);
                        if(!nextVid.src) {
                            nextVid.src = `${API_BASE}/stream/${shortsVideos[index + i]._id}`;
                            nextVid.preload = "auto";
                        }
                    }
                }
            } else {
                vid.pause();
                vid.currentTime = 0;
            }
        });
    }, options);

    document.querySelectorAll('.short-player-item').forEach(item => {
        shortsObserver.observe(item);
    });

    setTimeout(() => {
        const targetElement = document.querySelector(`.short-player-item[data-index="${startIndex}"]`);
        if(targetElement) targetElement.scrollIntoView();
    }, 100);
}

function openShortsPlayerByCat(catId, videoId) {
    const catShorts = allVideos.filter(v => v.category_id === catId && v.type === 'short');
    const index = catShorts.findIndex(v => v._id === videoId);
    if(index !== -1) {
        shortsVideos = catShorts; 
        openShortsPlayer(index);
    }
}

function closeShorts() {
    shortsContainer.classList.add("hidden");
    if(shortsObserver) shortsObserver.disconnect();
    shortsWrapper.innerHTML = "";
    shortsVideos = allVideos.filter(v => v.type === "short");
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
    document.getElementById("playerVideoTitle").innerText = vData.title;
    document.getElementById("playerVideoViews").innerText = (vData.view_count || 0) + " views";
    
    // Reset Player UI for a fresh look
    video.pause();
    video.currentTime = 0;
    progressBar.style.width = "0%";
    bufferBar.style.width = "0%";
    timeDisplay.innerText = "0:00 / 0:00";
    loadingSpinner.classList.remove('hidden');

    video.src = `${API_BASE}/stream/${videoId}`;
    video.load(); // Explicitly reload the video element
    video.play();
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    
    fetch(`${API_BASE}/views/${videoId}`, { method: 'POST' });
    resetControlsTimeout();
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
        togglePlayPause(); // Single tap now toggles Play/Pause
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
        const isFS = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        
        if (!isFS) {
            // ENTER FULLSCREEN
            const enterFS = playerContainer.requestFullscreen || playerContainer.webkitRequestFullscreen || playerContainer.mozRequestFullScreen || playerContainer.msRequestFullscreen;
            
            if (enterFS) {
                await enterFS.call(playerContainer);
                fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
                
                // Rotation Logic
                if (screen.orientation && screen.orientation.lock) {
                    await screen.orientation.lock("landscape").catch(e => console.log("Orientation lock blocked"));
                }
            } else if (video.webkitEnterFullscreen) {
                // Fallback for iOS/Telegram Webview specialized for video
                video.webkitEnterFullscreen();
            }
        } else {
            // EXIT FULLSCREEN
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

// Sync UI when fullscreen changes via system gestures
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

