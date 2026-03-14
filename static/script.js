const tg = window.Telegram.WebApp;
tg.expand();

let currentAdminId = "1326069145"; // Updated to user's Admin ID
let adminId = tg.initDataUnsafe?.user?.id?.toString();

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
    initNav();
    loadHome();
    checkAdmin();
    loadCategories();
});

// Admin Check
function checkAdmin() {
    if (adminId === currentAdminId) {
        document.getElementById('admin-nav-btn').style.display = 'flex';
    }
}

// Navigation
function initNav() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageId = item.getAttribute('data-page');
            if (pageId === 'trending') return; // Placeholder

            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            
            document.getElementById(pageId).classList.add('active');
            item.classList.add('active');

            if (pageId === 'shorts-page') loadShorts();
            if (pageId === 'admin-page') loadAdminVideos();
        });
    });
}

// Data Fetching
async function loadHome() {
    const response = await fetch('/api/videos');
    const videos = await response.json();
    
    const shorts = videos.filter(v => v.type === 'short');
    const longs = videos.filter(v => v.type === 'long');

    const homeContent = document.getElementById('home-content');
    homeContent.innerHTML = '';

    // 1. 2x2 Grid of 4 Shorts
    if (shorts.length > 0) {
        const grid1 = createShortsGrid(shorts.slice(0, 4));
        homeContent.appendChild(grid1);
    }

    // 2. Vertical list of 5 Long videos
    if (longs.length > 0) {
        const list = createLongList(longs.slice(0, 5));
        homeContent.appendChild(list);
    }

    // 3. 2x2 Grid of next 4 Shorts
    if (shorts.length > 4) {
        const grid2 = createShortsGrid(shorts.slice(4, 8));
        homeContent.appendChild(grid2);
    }
}

function createShortsGrid(shorts) {
    const grid = document.createElement('div');
    grid.className = 'shorts-grid';
    shorts.forEach(s => {
        const card = document.createElement('div');
        card.className = 'short-card';
        card.innerHTML = `
            <img src="/api/stream/${s.thumbnail_id}" style="width:100%; height:100%; object-fit:cover;">
            <div class="view-badge">${formatViews(s.view_count)} views</div>
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
                <img src="/api/stream/${l.thumbnail_id}">
                <div class="view-badge">${formatViews(l.view_count)} views</div>
            </div>
            <div style="padding:0 5px;">
                <div style="font-weight:bold;">${l.title}</div>
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
    const shorts = await response.json();
    const container = document.getElementById('shorts-container');
    container.innerHTML = '';

    shorts.forEach(s => {
        const wrapper = document.createElement('div');
        wrapper.className = 'short-video-wrapper';
        wrapper.innerHTML = `
            <video loop playsinline data-id="${s._id}">
                <source src="/api/stream/${s.file_id}" type="video/mp4">
            </video>
            <div style="position:absolute; bottom:20px; left:20px;">
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
    // Scroll to specific ID logic could be added here
}

// Long Player Overlay
function openLongPlayer(video) {
    const overlay = document.getElementById('video-overlay');
    const player = document.getElementById('long-video-player');
    overlay.style.display = 'block';
    player.src = `/api/stream/${video.file_id}`;
    document.getElementById('player-title').innerText = video.title;
    document.getElementById('player-views').innerText = `${formatViews(video.view_count)} views`;
    
    trackView(video._id, player);
    loadSuggestions(video._id);
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

// Admin Logic
async function loadCategories() {
    const response = await fetch('/api/categories');
    const cats = await response.json();
    const select = document.getElementById('video-category');
    select.innerHTML = cats.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
    
    const list = document.getElementById('category-list');
    if (list) list.innerHTML = cats.map(c => `<div class="cat-item">${c.name}</div>`).join('');
}

function showAdminTab(tab) {
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
    document.getElementById(`admin-${tab}`).style.display = 'block';
}

document.getElementById('category-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-category-name').value;
    const formData = new FormData();
    formData.append('name', name);

    const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': tg.initData },
        body: formData
    });
    if (response.ok) {
        alert('Category created!');
        loadCategories();
    }
};

document.getElementById('upload-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', document.getElementById('video-title').value);
    formData.append('category_id', document.getElementById('video-category').value);
    formData.append('type', document.querySelector('input[name="video-type"]:checked').value);
    formData.append('video_file', document.getElementById('video-file').files[0]);

    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    const statusText = document.getElementById('upload-status');
    
    progressContainer.style.display = 'block';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/upload', true);
    xhr.setRequestHeader('X-Telegram-Init-Data', tg.initData);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = percent + '%';
            statusText.innerText = percent + '%';
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            alert('Upload successful!');
            progressContainer.style.display = 'none';
            loadHome();
        } else {
            alert('Upload failed: ' + xhr.responseText);
        }
    };

    xhr.send(formData);
};

async function loadAdminVideos() {
    const response = await fetch('/api/videos');
    const videos = await response.json();
    const list = document.getElementById('admin-video-list');
    list.innerHTML = videos.map(v => `<li>${v.title} (${v.type}) - ${v.view_count} views</li>`).join('');
}

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
                <img src="/api/stream/${s.thumbnail_id}">
            </div>
            <div style="font-size:12px;">${s.title}</div>
        `;
        item.onclick = () => openLongPlayer(s);
        list.appendChild(item);
    });
}
