const API_BASE = "http://localhost:7860/api"; // Aapka Railway/Backend URL lagayein

let allVideos = [];
let shortsVideos = [];
let longVideos = [];

// DOM Elements
const mainContent = document.getElementById("main-content");
const bottomNavItems = document.querySelectorAll(".nav-item");

// On Load
window.addEventListener("DOMContentLoaded", async () => {
    await fetchAllVideos();
    loadHome();
});

// Fetch Data
async function fetchAllVideos() {
    try {
        const res = await fetch(`${API_BASE}/videos`);
        allVideos = await res.json();
        shortsVideos = allVideos.filter(v => v.type === "short");
        longVideos = allVideos.filter(v => v.type === "long");
    } catch (e) {
        console.error("Error fetching videos:", e);
    }
}

// Update Active Nav
function setActiveNav(index) {
    bottomNavItems.forEach(item => item.classList.remove("active"));
    bottomNavItems[index].classList.add("active");
}

/* =======================================
   POINT 6: HOME FEED ALGORITHM (4 Shorts, 5 Long)
======================================= */
function loadHome() {
    setActiveNav(0);
    mainContent.innerHTML = "";
    
    let sIndex = 0;
    let lIndex = 0;

    // Loop until we run out of both
    while(sIndex < shortsVideos.length || lIndex < longVideos.length) {
        
        // 1. Add 4 Shorts (2x2 Grid)
        if (sIndex < shortsVideos.length) {
            let chunk = shortsVideos.slice(sIndex, sIndex + 4);
            let shortsHTML = `
                <div class="shorts-shelf">
                    <div class="shorts-shelf-title"><i class="fas fa-bolt"></i> Shorts</div>
                    <div class="shorts-grid">
                        ${chunk.map((video, idx) => `
                            <div class="short-card-home" onclick="openShortsPlayer(${sIndex + idx})">
                                <img src="${API_BASE}/stream?file_id=${video.thumbnail_id}&is_image=true" onerror="this.src='https://via.placeholder.com/200x350?text=Short'">
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
                        <img src="${API_BASE}/stream?file_id=${video.thumbnail_id}&is_image=true" onerror="this.src='https://via.placeholder.com/640x360'">
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
   POINT 7: CATEGORY LAYOUT
======================================= */
async function loadCategoriesTab() {
    setActiveNav(2);
    mainContent.innerHTML = "<div style='text-align:center; padding:20px;'>Loading...</div>";
    
    try {
        const catRes = await fetch(`${API_BASE}/categories`);
        const categories = await catRes.json();
        
        mainContent.innerHTML = "";
        
        for (let cat of categories) {
            const catVideos = allVideos.filter(v => v.category_id === cat._id);
            if(catVideos.length === 0) continue;

            // Take max 5 videos for horizontal scroll
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
                                    <img src="${API_BASE}/stream?file_id=${v.thumbnail_id}&is_image=true" onerror="this.src='https://via.placeholder.com/320x180'">
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
        <h2 style="padding:15px; border-bottom:1px solid #333;"><i class="fas fa-arrow-left" onclick="loadCategoriesTab()" style="margin-right:10px; cursor:pointer;"></i> ${catName}</h2>
    `;
    catVideos.forEach(video => {
        mainContent.innerHTML += `
            <div class="long-video-card" onclick="${video.type === 'long' ? `openLongPlayer('${video._id}')` : `openShortsPlayerByCat('${catId}', '${video._id}')`}">
                <div class="thumbnail-container">
                    <img src="${API_BASE}/stream?file_id=${video.thumbnail_id}&is_image=true">
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
   POINTS 1 & 2: SHORTS PLAYER & PRELOAD NEXT 2
======================================= */
const shortsContainer = document.getElementById("shorts-fullscreen-container");
const shortsWrapper = document.getElementById("shorts-wrapper");
let shortsObserver;

function openShortsPlayer(startIndex = 0) {
    shortsContainer.classList.remove("hidden");
    shortsWrapper.innerHTML = "";
    
    // Render all shorts divs, but don't set video src yet
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

    // Intersection Observer for playing current and preloading next 2
    const options = { root: shortsWrapper, threshold: 0.7 };
    
    shortsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = parseInt(entry.target.getAttribute('data-index'));
            const vid = document.getElementById(`short-vid-${index}`);
            
            if (entry.isIntersecting) {
                // Play current
                if(!vid.src) vid.src = `${API_BASE}/stream/${shortsVideos[index]._id}`;
                vid.play().catch(e => console.log("Auto-play prevented"));
                
                // Add view
                fetch(`${API_BASE}/views/${shortsVideos[index]._id}`, { method: 'POST' });

                // PRELOAD NEXT 2 VIDEOS (Point 2)
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
                // Pause if not visible
                vid.pause();
                vid.currentTime = 0;
            }
        });
    }, options);

    document.querySelectorAll('.short-player-item').forEach(item => {
        shortsObserver.observe(item);
    });

    // Scroll to clicked short
    setTimeout(() => {
        const targetElement = document.querySelector(`.short-player-item[data-index="${startIndex}"]`);
        if(targetElement) targetElement.scrollIntoView();
    }, 100);
}

function openShortsPlayerByCat(catId, videoId) {
    const catShorts = allVideos.filter(v => v.category_id === catId && v.type === 'short');
    const index = catShorts.findIndex(v => v._id === videoId);
    if(index !== -1) {
        // Replace temp global shorts logic for category view
        shortsVideos = catShorts; 
        openShortsPlayer(index);
    }
}

function closeShorts() {
    shortsContainer.classList.add("hidden");
    if(shortsObserver) shortsObserver.disconnect();
    shortsWrapper.innerHTML = ""; // Stop all videos
    shortsVideos = allVideos.filter(v => v.type === "short"); // Reset back
}

/* =======================================
   POINTS 3, 4, 5, 8: LONG VIDEO PLAYER
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
    
    video.src = `${API_BASE}/stream/${videoId}`;
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

// Show/Hide Controls on Tap (Point 4)
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

// Double Tap to Skip Logic (Point 3 & 4 tap handler)
playerContainer.addEventListener('click', (e) => {
    // Ignore clicks on controls bar itself
    if(e.target.closest('.controls-bottom') || e.target.closest('.close-player-btn')) return;

    let currentTime = new Date().getTime();
    let tapGap = currentTime - lastTap;
    
    if (tapGap < 300 && tapGap > 0) {
        // It's a double tap
        clearTimeout(controlsTimeout);
        let rect = playerContainer.getBoundingClientRect();
        let tapX = e.clientX - rect.left;
        
        if (tapX < rect.width / 2) {
            // Rewind
            video.currentTime -= 10;
            rewindInd.classList.add('show');
            setTimeout(() => rewindInd.classList.remove('show'), 500);
        } else {
            // Forward
            video.currentTime += 10;
            forwardInd.classList.add('show');
            setTimeout(() => forwardInd.classList.remove('show'), 500);
        }
    } else {
        // Single tap
        toggleControls();
    }
    lastTap = currentTime;
});

// Buffering Spinner (Point 3)
video.addEventListener('waiting', () => { loadingSpinner.classList.remove('hidden'); });
video.addEventListener('playing', () => { loadingSpinner.classList.add('hidden'); });
video.addEventListener('canplay', () => { loadingSpinner.classList.add('hidden'); });

// Progress and Buffer Bar (Point 4)
video.addEventListener("timeupdate", () => {
    if (!video.duration) return;
    
    // Play Progress
    const progress = (video.currentTime / video.duration) * 100;
    progressBar.style.width = `${progress}%`;
    
    // Time Display
    let curMins = Math.floor(video.currentTime / 60);
    let curSecs = Math.floor(video.currentTime % 60).toString().padStart(2, '0');
    let durMins = Math.floor(video.duration / 60);
    let durSecs = Math.floor(video.duration % 60).toString().padStart(2, '0');
    timeDisplay.innerText = `${curMins}:${curSecs} / ${durMins}:${durSecs}`;
});

video.addEventListener('progress', () => {
    if (video.duration > 0 && video.buffered.length > 0) {
        // Download Buffer Progress
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferProgress = (bufferedEnd / video.duration) * 100;
        bufferBar.style.width = `${bufferProgress}%`;
    }
});

// Seek Video
progressContainer.addEventListener("click", (e) => {
    const width = progressContainer.clientWidth;
    const clickX = e.offsetX;
    const duration = video.duration;
    video.currentTime = (clickX / width) * duration;
    resetControlsTimeout();
});

// Play/Pause button
playPauseBtn.addEventListener("click", () => {
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
});

// Mute button
muteBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    resetControlsTimeout();
});

// Auto-Rotate & Fullscreen Logic (Point 8)
fullscreenBtn.addEventListener("click", async () => {
    try {
        if (!document.fullscreenElement) {
            await playerContainer.requestFullscreen();
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
            // Try to force landscape orientation if supported (Mobile)
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock("landscape").catch(e => console.log("Orientation lock not supported"));
            }
        } else {
            await document.exitFullscreen();
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
            // Unlock orientation back to portrait
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        }
    } catch (e) {
        console.log("Fullscreen Error:", e);
    }
});
