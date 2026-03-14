const tg = window.Telegram.WebApp;
tg.expand();

let currentAdminId = "1326069145"; // Updated to user's Admin ID
let adminId = tg.initDataUnsafe?.user?.id?.toString();

let currentShortsSort = 'new'; // Global sort state

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
    initNav(); // Initialize navigation first
    checkAdmin();
    loadHome();
    loadCategories();
    initSearch();
    initShortsSort();
});

// Shorts Sorting Logic
function initShortsSort() {
    const btn = document.getElementById('shorts-sort-btn');
    const menu = document.getElementById('shorts-sort-menu');
    const label = document.getElementById('current-sort-label');
    const options = document.querySelectorAll('.sort-option');

    if (!btn) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    };

    document.addEventListener('click', () => {
        if (menu) menu.style.display = 'none';
    });

    options.forEach(opt => {
        opt.onclick = () => {
            currentShortsSort = opt.dataset.sort;
            label.innerText = opt.innerText;
            loadShorts();
        };
    });
}

// Search Logic
function initSearch() {
    const searchBtn = document.getElementById('search-btn');
    const searchContainer = document.querySelector('.search-container');
    const searchInput = document.getElementById('search-input');
    const logo = document.querySelector('.logo');

    if (!searchBtn) return;

    searchBtn.onclick = () => {
        if (searchContainer.style.display === 'none') {
            searchContainer.style.display = 'block';
            logo.style.display = 'none';
            searchInput.focus();
        } else {
            if (searchInput.value) {
                performSearch(searchInput.value);
            } else {
                searchContainer.style.display = 'none';
                logo.style.display = 'block';
            }
        }
    };

    searchInput.onkeyup = (e) => {
        if (e.key === 'Enter') performSearch(searchInput.value);
    };
}

async function performSearch(query) {
    if (!query) return;
    
    // Switch to search page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('search-page').classList.add('active');
    
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<p style="padding:20px;">Searching...</p>';
    
    const response = await fetch(`/api/videos/search?q=${encodeURIComponent(query)}`);
    const videos = await response.json();
    
    resultsContainer.innerHTML = `<h2 style="padding:10px;">Results for "${query}"</h2>`;
    if (videos.length === 0) {
        resultsContainer.innerHTML += '<p style="padding:20px;">No videos found.</p>';
        return;
    }
    
    const list = createLongList(videos);
    resultsContainer.appendChild(list);
}

// Admin Check
function checkAdmin() {
    console.log("Checking Admin... App User ID:", adminId, "Target ID:", currentAdminId);
    
    // Ensure both are compared as strings to avoid type issues
    if (adminId && String(adminId) === String(currentAdminId)) {
        console.log("Admin Match Found! Displaying Panel.");
        const adminBtn = document.getElementById('admin-nav-btn');
        if (adminBtn) adminBtn.style.display = 'flex';
    } else {
        console.log("Admin Match Failed.");
    }
}

// Navigation
function initNav() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageId = item.getAttribute('data-page');
            console.log("Navigating to:", pageId);

            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            
            const targetPage = document.getElementById(pageId);
            if (targetPage) {
                targetPage.classList.add('active');
                item.classList.add('active');
                
                // Hide search bar if navigating away
                const searchContainer = document.querySelector('.search-container');
                const logo = document.querySelector('.logo');
                if (searchContainer && logo) {
                    searchContainer.style.display = 'none';
                    logo.style.display = 'flex';
                }
            } else {
                console.error("Target page not found:", pageId);
            }

            if (pageId === 'shorts-page') loadShorts();
            if (pageId === 'trending-page') loadTrending();
            if (pageId === 'category-page') loadCategories();
            if (pageId === 'admin-page') loadAdminVideos();
        });
    });
}

async function loadTrending() {
    const container = document.getElementById('trending-content');
    container.innerHTML = '<p style="padding:20px;">Loading trending...</p>';
    
    const response = await fetch('/api/videos/trending');
    const videos = await response.json();
    
    container.innerHTML = '';
    if (videos.length === 0) {
        container.innerHTML = '<p style="padding:20px;">No trending videos yet.</p>';
        return;
    }
    
    const list = createLongList(videos);
    container.appendChild(list);
}

// Data Fetching
async function loadHome() {
    const response = await fetch('/api/videos');
    const videos = await response.json();
    
    const shorts = videos.filter(v => v.type === 'short');
    const longs = videos.filter(v => v.type === 'long');

    const homeContent = document.getElementById('home-content');
    homeContent.innerHTML = '';

    // 1. Shorts Section
    if (shorts.length > 0) {
        const title = document.createElement('div');
        title.className = 'section-title';
        title.innerHTML = '<svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:red;"><path d="M17.6 9.48l-.8-4.8c-.23-1.4-1.54-2.43-2.95-2.2L9.05 3.28c-1.4.23-2.43 1.54-2.2 2.95l.8 4.8-4.8.8c-1.4.23-2.43 1.54-2.2 2.95l.8 4.8c.23 1.4 1.54 2.43 2.95 2.2l4.8-.8-.8-4.8c-.23-1.4-1.54-2.43-2.95-2.2l4.8-.8.8 4.8c.23 1.4 1.54 2.43 2.95 2.2l4.8-.8.8 4.8c.23 1.4 1.54 2.43 2.95 2.2l4.8-.8.8 4.8c.23 1.4 1.54 2.43 2.95 2.2l-4.8.8z"/></svg> Shorts';
        homeContent.appendChild(title);
        
        const grid1 = createShortsGrid(shorts.slice(0, 4));
        homeContent.appendChild(grid1);
    }

    // 2. Long Videos Section
    if (longs.length > 0) {
        const title = document.createElement('div');
        title.className = 'section-title';
        title.innerText = 'Recommended';
        homeContent.appendChild(title);

        const list = createLongList(longs);
        homeContent.appendChild(list);
    }
}

function createShortsGrid(shorts) {
    const grid = document.createElement('div');
    grid.className = 'shorts-grid';
    shorts.forEach(s => {
        const card = document.createElement('div');
        card.className = 'short-card';
        card.innerHTML = `
            <img src="/api/stream?file_id=${encodeURIComponent(s.thumbnail_id)}&is_image=true">
            <div class="short-info">
                <div class="short-title">${s.title}</div>
                <div style="font-size:10px; color:#ccc;">${formatViews(s.view_count)} views</div>
            </div>
        `;
        card.onclick = () => openShortsAt(s._id);
        grid.appendChild(card);
    });
    return grid;
}

function createLongList(longs) {
    const list = document.createElement('div');
    list.className = 'long-list';
    longs.forEach(l => {
        const card = document.createElement('div');
        card.className = 'long-card';
        card.innerHTML = `
            <div class="thumbnail-container">
                <img src="/api/stream?file_id=${encodeURIComponent(l.thumbnail_id)}&is_image=true">
                <div class="view-badge" style="bottom:8px; right:8px;">${formatViews(l.view_count)} views</div>
            </div>
            <div class="long-info">
                <div class="channel-avatar">T</div>
                <div class="video-details">
                    <div class="video-title">${l.title}</div>
                    <div class="video-meta">TeleTube • ${formatViews(l.view_count)} views</div>
                </div>
            </div>
        `;
        card.onclick = () => openLongPlayer(l);
        list.appendChild(card);
    });
    return list;
}

// Shorts Player Logic
async function loadShorts() {
    const response = await fetch('/api/videos?type=short');
    let shorts = await response.json();

    // Apply Sorting
    if (currentShortsSort === 'new') {
        shorts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (currentShortsSort === 'old') {
        shorts.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else if (currentShortsSort === 'random') {
        shorts.sort(() => Math.random() - 0.5);
    }

    const container = document.getElementById('shorts-container');
    container.innerHTML = '';

    shorts.forEach(s => {
        const wrapper = document.createElement('div');
        wrapper.className = 'short-video-wrapper';
        wrapper.innerHTML = `
            <video loop playsinline muted data-id="${s._id}">
                <source src="/api/stream/${s._id}" type="video/mp4">
            </video>
            <div style="position:absolute; bottom:20px; left:20px; pointer-events:none;">
                <h3>${s.title}</h3>
                <p>${formatViews(s.view_count)} views</p>
            </div>
        `;
        container.appendChild(wrapper);
    });

    // Auto-play observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (entry.isIntersecting) {
                video.play();
                trackView(video.dataset.id, video);
            } else {
                video.pause();
                video.currentTime = 0;
            }
        });
    }, { threshold: 0.7 });

    document.querySelectorAll('.short-video-wrapper').forEach(w => observer.observe(w));
}

function openShortsAt(id) {
    document.querySelector('.nav-item[data-page="shorts-page"]').click();
    
    // Give it a moment for the page to render
    setTimeout(() => {
        const container = document.getElementById('shorts-container');
        const videoElement = container.querySelector(`video[data-id="${id}"]`);
        if (videoElement) {
            videoElement.parentElement.scrollIntoView({ behavior: 'auto' });
            videoElement.play();
        }
    }, 100);
}

// Long Player Overlay
function openLongPlayer(video) {
    const overlay = document.getElementById('video-overlay');
    const player = document.getElementById('long-video-player');
    overlay.style.display = 'block';
    player.src = `/api/stream/${video._id}`;
    document.getElementById('player-title').innerText = video.title;
    document.getElementById('player-views').innerText = `${formatViews(video.view_count)} views`;
    
    initCustomPlayer(player);
    trackView(video._id, player);
    loadSuggestions(video._id);
    
    // Fix: Force load then play
    player.load();
    player.play().catch(e => console.error("Auto-play failed:", e));
}

function initCustomPlayer(player) {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const currentTimeEl = document.getElementById('current-time');
    const durationEl = document.getElementById('duration');
    const playerWrapper = document.getElementById('player-wrapper');
    const muteBtn = document.getElementById('mute-btn');
    const muteIcon = document.getElementById('mute-icon');
    const fullscreenBtn = document.getElementById('fullscreen-btn');

    // Fullscreen Logic
    fullscreenBtn.onclick = (e) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
            if (playerWrapper.requestFullscreen) {
                playerWrapper.requestFullscreen();
            } else if (playerWrapper.webkitRequestFullscreen) { /* Safari */
                playerWrapper.webkitRequestFullscreen();
            } else if (playerWrapper.msRequestFullscreen) { /* IE11 */
                playerWrapper.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    // Mute/Unmute Logic
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        player.muted = !player.muted;
        updateMuteIcon();
    };

    function updateMuteIcon() {
        if (player.muted) {
            muteIcon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
        } else {
            muteIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
        }
    }

    // Ensure icon is correct on init
    updateMuteIcon();

    // Update progress bar
    player.ontimeupdate = () => {
        const percent = (player.currentTime / player.duration) * 100;
        progressBar.style.width = percent + '%';
        currentTimeEl.innerText = formatTime(player.currentTime);
        durationEl.innerText = formatTime(player.duration);
    };

    // Seek on progress bar click
    progressContainer.onclick = (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        player.currentTime = pos * player.duration;
    };

    // Double tap to skip
    let lastTap = 0;
    playerWrapper.onclick = (e) => {
        const now = Date.now();
        const TIMESPAN = 300;
        if (now - lastTap < TIMESPAN) {
            const rect = playerWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 2) {
                skipVideo(-10);
            } else {
                skipVideo(10);
            }
        }
        lastTap = now;
    };

    function skipVideo(seconds) {
        const newTime = player.currentTime + seconds;
        player.currentTime = Math.max(0, Math.min(newTime, player.duration));
        
        // Show feedback overlay
        const overlayId = seconds > 0 ? 'skip-right' : 'skip-left';
        const overlay = document.getElementById(overlayId);
        overlay.classList.remove('skip-animate');
        void overlay.offsetWidth; // trigger reflow
        overlay.classList.add('skip-animate');
        
        setTimeout(() => overlay.classList.remove('skip-animate'), 600);
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

document.querySelector('.close-btn').onclick = () => {
    const overlay = document.getElementById('video-overlay');
    const player = document.getElementById('long-video-player');
    overlay.style.display = 'none';
    player.pause();
    player.src = "";
};

// View Tracking
function trackView(videoId, videoElement) {
    let viewed = false;
    const checkView = () => {
        if (!viewed && videoElement.currentTime >= 3) {
            viewed = true;
            fetch(`/api/views/${videoId}`, { method: 'POST' });
            videoElement.removeEventListener('timeupdate', checkView);
        }
    };
    videoElement.addEventListener('timeupdate', checkView);
}

function toggleDropdown(listId) {
    const list = document.getElementById(listId);
    const box = list.previousElementSibling;
    const allLists = document.querySelectorAll('.custom-options-list');
    
    // Close other dropdowns
    allLists.forEach(l => {
        if (l.id !== listId) {
            l.style.display = 'none';
            l.parentElement.classList.remove('dropdown-active');
        }
    });

    if (list.style.display === 'block') {
        list.style.display = 'none';
        box.parentElement.classList.remove('dropdown-active');
    } else {
        list.style.display = 'block';
        box.parentElement.classList.add('dropdown-active');
    }
}

function selectOption(option, hiddenInputId, boxId, textId) {
    const hiddenInput = document.getElementById(hiddenInputId);
    const boxText = document.getElementById(textId);
    const list = option.parentElement;

    hiddenInput.value = option.dataset.id;
    boxText.innerText = option.innerText;
    boxText.style.color = 'white';

    list.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');

    list.style.display = 'none';
    list.parentElement.classList.remove('dropdown-active');
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
        document.querySelectorAll('.custom-options-list').forEach(l => l.style.display = 'none');
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('dropdown-active'));
    }
});

// Admin Logic
async function loadCategories() {
    const response = await fetch('/api/categories');
    const categories = await response.json();
    
    // Render Admin Upload Dropdown Options
    const uploadList = document.getElementById('upload-category-list');
    if (uploadList) {
        uploadList.innerHTML = categories.map(c => `
            <div class="custom-option" data-id="${c._id}" onclick="selectOption(this, 'video-category', 'upload-category-box', 'upload-selected-text')">${c.name}</div>
        `).join('');
    }

    // For Category Page UI
    const container = document.getElementById('category-sections');
    if (!container) return;
    container.innerHTML = '';

    // Fetch all videos to distribute them by category (more efficient than many small calls)
    const videosResponse = await fetch('/api/videos');
    const allVideos = await videosResponse.json();

    for (const cat of categories) {
        const catVideos = allVideos.filter(v => v.category_id === cat._id);
        if (catVideos.length === 0) continue;

        const section = document.createElement('div');
        section.className = 'category-section';
        
        section.innerHTML = `
            <div class="section-header">
                <h3 style="font-size:16px;">${cat.name}</h3>
                <button class="view-all-btn" onclick="loadCategoryDetail('${cat._id}', '${cat.name}')">View All</button>
            </div>
            <div class="horizontal-scroll">
                ${catVideos.slice(0, 5).map(v => `
                    <div class="cat-thumb-card" onclick="openVideo('${v._id}')">
                        <div class="cat-thumb-img">
                            <img src="/api/stream?file_id=${encodeURIComponent(v.thumbnail_id)}&is_image=true">
                        </div>
                        <div class="cat-video-title">${v.title}</div>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(section);
    }
}

async function loadCategoryDetail(catId, catName) {
    // Switch Page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('category-detail-page').classList.add('active');
    
    document.getElementById('category-detail-title').innerText = catName;
    const detailContent = document.getElementById('category-detail-content');
    detailContent.innerHTML = '<p style="padding:20px;">Loading category videos...</p>';

    const response = await fetch(`/api/videos/category/${catId}`);
    const videos = await response.json();

    detailContent.innerHTML = '';
    const list = createLongList(videos);
    detailContent.appendChild(list);
}

function openVideo(videoId) {
    // Helper to open player based on video object (fetches first)
    fetch('/api/videos').then(res => res.json()).then(videos => {
        const video = videos.find(v => v._id === videoId);
        if (video) {
            if (video.type === 'short') {
                openShortsAt(video._id);
            } else {
                openLongPlayer(video);
            }
        }
    });
}

function showAdminTab(tab) {
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`admin-${tab}`).style.display = 'block';
    
    // Update active button state
    document.querySelectorAll('.admin-tabs button').forEach(btn => btn.classList.remove('active-tab'));
    if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('active-tab');
    }
}

document.getElementById('category-form').onsubmit = async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('new-category-name');
    const name = nameInput.value;
    const formData = new FormData();
    formData.append('name', name);

    const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': tg.initData },
        body: formData
    });
    if (response.ok) {
        alert('Category created!');
        nameInput.value = ''; // Clear input
        loadCategories();
    }
};

document.getElementById('upload-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData();
    formData.append('title', document.getElementById('video-title').value);
    formData.append('category_id', document.getElementById('video-category').value);
    formData.append('type', document.querySelector('input[name="video-type"]:checked').value);
    formData.append('video_file', document.getElementById('video-file').files[0]);

    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status-message');
    const uploadBtn = document.getElementById('upload-btn');
    
    progressContainer.style.display = 'block';
    statusText.style.color = 'white';
    uploadBtn.disabled = true;
    uploadBtn.style.opacity = '0.5';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/upload', true);
    xhr.setRequestHeader('X-Telegram-Init-Data', tg.initData);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = percent + '%';
            statusText.innerText = `Uploading: ${percent}%`;
        }
    };

    xhr.onload = () => {
        uploadBtn.disabled = false;
        uploadBtn.style.opacity = '1';
        if (xhr.status === 200) {
            statusText.innerText = '✅ Video Uploaded Successfully!';
            statusText.style.color = '#4CAF50';
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
                form.reset();
                // Reset custom dropdown UI
                document.getElementById('upload-selected-text').innerText = 'Select Category';
                document.getElementById('upload-selected-text').style.color = 'var(--text-secondary)';
                document.getElementById('video-category').value = '';
                loadHome();
            }, 3000);
        } else {
            statusText.innerText = '❌ Upload Failed: ' + xhr.responseText;
            statusText.style.color = '#FF5252';
        }
    };

    xhr.onerror = () => {
        uploadBtn.disabled = false;
        uploadBtn.style.opacity = '1';
        statusText.innerText = '❌ Connection Error!';
        statusText.style.color = '#FF5252';
    };

    xhr.send(formData);
};

let allAdminVideos = [];
async function loadAdminVideos() {
    const response = await fetch('/api/videos');
    allAdminVideos = await response.json();
    renderAdminVideoList(allAdminVideos);
    
    // Setup Admin Search
    const searchInput = document.getElementById('admin-video-search');
    searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allAdminVideos.filter(v => v.title.toLowerCase().includes(query));
        renderAdminVideoList(filtered);
    };
}

function renderAdminVideoList(videos) {
    const container = document.getElementById('admin-video-list-container');
    container.innerHTML = '';
    
    videos.forEach(v => {
        const item = document.createElement('div');
        item.style = "display:flex; align-items:center; background:#222; padding:10px; border-radius:8px; gap:10px;";
        item.innerHTML = `
            <img src="/api/stream?file_id=${encodeURIComponent(v.thumbnail_id)}&is_image=true" style="width:60px; height:40px; object-fit:cover; border-radius:4px;">
            <div style="flex:1;">
                <div style="font-size:14px; font-weight:bold;">${v.title}</div>
                <div style="font-size:12px; color:#aaa;">${v.type} | ${v.view_count} views</div>
            </div>
            <div style="display:flex; gap:5px;">
                <button onclick="openEditModal('${v._id}', '${v.title}', '${v.category_id}')" style="background:#444; color:white; border:none; padding:5px 8px; border-radius:4px; font-size:12px;">Edit</button>
                <button onclick="deleteVideo('${v._id}')" style="background:red; color:white; border:none; padding:5px 8px; border-radius:4px; font-size:12px;">Delete</button>
            </div>
        `;
        container.appendChild(item);
    });
}

async function deleteVideo(id) {
    if (!confirm('Are you sure you want to delete this video?')) return;
    const response = await fetch(`/api/admin/video/${id}`, {
        method: 'DELETE',
        headers: { 'X-Telegram-Init-Data': tg.initData }
    });
    if (response.ok) {
        alert('Video deleted!');
        loadAdminVideos();
        loadHome();
    }
}

async function openEditModal(id, title, catId) {
    const modal = document.getElementById('edit-modal');
    modal.style.display = 'block';
    document.getElementById('edit-video-id').value = id;
    document.getElementById('edit-video-title').value = title;
    
    const response = await fetch('/api/categories');
    const cats = await response.json();
    const list = document.getElementById('edit-category-list');
    const boxText = document.getElementById('edit-selected-text');
    const hiddenInput = document.getElementById('edit-video-category');
    
    // Find current category name
    const currentCat = cats.find(c => c._id === catId);
    boxText.innerText = currentCat ? currentCat.name : 'Select Category';
    boxText.style.color = 'white';
    hiddenInput.value = catId;

    list.innerHTML = cats.map(c => `
        <div class="custom-option ${c._id === catId ? 'selected' : ''}" data-id="${c._id}" onclick="selectOption(this, 'edit-video-category', 'edit-category-box', 'edit-selected-text')">${c.name}</div>
    `).join('');
}

document.getElementById('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-video-id').value;
    const formData = new FormData();
    formData.append('title', document.getElementById('edit-video-title').value);
    formData.append('category_id', document.getElementById('edit-video-category').value);

    const response = await fetch(`/api/admin/video/${id}`, {
        method: 'PATCH',
        headers: { 'X-Telegram-Init-Data': tg.initData },
        body: formData
    });
    if (response.ok) {
        alert('Update successful!');
        document.getElementById('edit-modal').style.display = 'none';
        loadAdminVideos();
        loadHome();
    }
};

function formatViews(n) {
    if (n < 1000) return n;
    if (n < 1000000) return (n/1000).toFixed(1) + 'K';
    return (n/1000000).toFixed(1) + 'M';
}

async function loadSuggestions(currentId) {
    const response = await fetch('/api/videos?type=long');
    const videos = await response.json();
    const suggestions = videos.filter(v => v._id !== currentId).sort(() => 0.5 - Math.random()).slice(0, 5);
    
    const list = document.getElementById('suggestion-list');
    list.innerHTML = '';
    suggestions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'long-card';
        item.innerHTML = `
            <div class="thumbnail-container" style="aspect-ratio: 16/9;">
                <img src="/api/stream?file_id=${encodeURIComponent(s.thumbnail_id)}&is_image=true">
            </div>
            <div style="font-size:12px;">${s.title}</div>
        `;
        item.onclick = () => openLongPlayer(s);
        list.appendChild(item);
    });
}
