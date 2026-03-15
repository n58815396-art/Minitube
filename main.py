import os
import asyncio
import hmac
import hashlib
import json
import uuid
from datetime import datetime, timedelta
from typing import Optional, List
from urllib.parse import parse_qs

import cv2
import aiofiles
import aiohttp
from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pyrogram import Client
from pyrogram.types import Message
from dotenv import load_dotenv

load_dotenv()

API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
BOT_TOKEN = os.getenv("BOT_TOKEN")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
ADMIN_ID = os.getenv("ADMIN_ID") 
CHAT_ID = os.getenv("CHAT_ID")   
PIXELDRAIN_KEYS = os.getenv("PIXELDRAIN_API_KEY", "").split(",")
CF_WORKER_URL = "https://minitube-stream.f0471649.workers.dev"
current_key_idx = 0

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client["mini_clips"]
tg_client = Client("mini_clips_session", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

async def upload_to_pixeldrain(file_path: str):
    global current_key_idx
    if not PIXELDRAIN_KEYS or not PIXELDRAIN_KEYS[0]: return None
    for _ in range(len(PIXELDRAIN_KEYS)):
        try:
            key = PIXELDRAIN_KEYS[current_key_idx].strip()
            current_key_idx = (current_key_idx + 1) % len(PIXELDRAIN_KEYS)
            data = aiohttp.FormData()
            data.add_field('file', open(file_path, 'rb'), filename=os.path.basename(file_path))
            auth = aiohttp.BasicAuth('', key)
            async with aiohttp.ClientSession() as session:
                async with session.post("https://pixeldrain.com/api/file", data=data, auth=auth) as resp:
                    result = await resp.json()
                    if result.get("success"): return result.get("id")
        except Exception as e: print(f"Pixeldrain Upload Error: {e}")
    return None

async def get_working_file_id(video_doc):
    file_id = video_doc.get("file_id")
    message_id = video_doc.get("message_id")
    if message_id:
        try:
            msg = await tg_client.get_messages(int(CHAT_ID), int(message_id))
            if msg and msg.video:
                new_file_id = msg.video.file_id
                if new_file_id != file_id: await db.videos.update_one({"_id": video_doc["_id"]}, {"$set": {"file_id": new_file_id}})
                return new_file_id
        except Exception as e: print(f"[Refresh] Error: {e}")
    return file_id

async def background_healer():
    while True:
        try:
            threshold_date = datetime.utcnow() - timedelta(days=45)
            cursor = db.videos.find({"last_active": {"$lt": threshold_date}})
            async for video in cursor:
                pixeldrain_id = video.get("pixeldrain_id")
                if not pixeldrain_id: continue
                url = f"https://pixeldrain.com/api/file/{pixeldrain_id}"
                async with aiohttp.ClientSession() as session:
                    async with session.head(url) as resp:
                        if resp.status == 404:
                            file_to_download = await get_working_file_id(video)
                            temp_path = await tg_client.download_media(file_to_download)
                            new_pd_id = await upload_to_pixeldrain(temp_path)
                            if new_pd_id: await db.videos.update_one({"_id": video["_id"]}, {"$set": {"pixeldrain_id": new_pd_id, "last_active": datetime.utcnow()}})
                            if os.path.exists(temp_path): os.remove(temp_path)
                        else:
                            async with session.get(url, headers={"Range": "bytes=0-1"}) as ping_resp: pass
                            await db.videos.update_one({"_id": video["_id"]}, {"$set": {"last_active": datetime.utcnow()}})
        except Exception as e: print(f"[Auto-Healer] Error: {e}")
        await asyncio.sleep(86400)

@app.on_event("startup")
async def startup():
    await tg_client.start()
    asyncio.create_task(background_healer())

@app.on_event("shutdown")
async def shutdown(): await tg_client.stop()

async def get_user_id(x_telegram_init_data: Optional[str] = Header(None)):
    if not x_telegram_init_data: return "guest"
    try:
        parsed_data = parse_qs(x_telegram_init_data)
        received_hash = parsed_data.get('hash', [None])[0]
        data_to_check = {k: v[0] for k, v in parsed_data.items() if k != 'hash'}
        data_list = sorted([f"{k}={v}" for k, v in data_to_check.items()])
        data_check_string = "\n".join(data_list)
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if calculated_hash != received_hash: return "guest"
        user = json.loads(data_to_check.get("user", "{}"))
        return str(user.get("id"))
    except: return "guest"

async def get_admin(x_telegram_init_data: Optional[str] = Header(None)):
    if not x_telegram_init_data: raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        parsed_data = parse_qs(x_telegram_init_data)
        received_hash = parsed_data.get('hash', [None])[0]
        data_to_check = {k: v[0] for k, v in parsed_data.items() if k != 'hash'}
        data_list = sorted([f"{k}={v}" for k, v in data_to_check.items()])
        data_check_string = "\n".join(data_list)
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if calculated_hash != received_hash: raise HTTPException(status_code=403, detail="Invalid")
        user = json.loads(data_to_check.get("user", "{}"))
        if str(user.get("id")) != ADMIN_ID: raise HTTPException(status_code=403, detail="Forbidden")
        return str(user.get("id"))
    except: raise HTTPException(status_code=401, detail="Auth Failed")

ADMIN_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>T-Tube Admin</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: Arial, sans-serif; background: #0f0f0f; color: #fff; padding: 20px; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f0f0f; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #00d2ff; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .card { background: #222; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        label { display: block; margin-top: 15px; margin-bottom: 5px; font-size: 13px; color: #aaa; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
        input, select, button { width: 100%; padding: 12px; margin: 5px 0 15px 0; border-radius: 6px; border: 1px solid #444; background: #333; color: white; outline: none; }
        input:focus, select:focus { border-color: #00d2ff; }
        input.error-input, select.error-input { border-color: #ff4444 !important; background: rgba(255, 68, 68, 0.05); }
        button { background: #00d2ff; color: #000; font-weight: bold; border: none; cursor: pointer; transition: 0.2s; }
        button:hover { background: #00b8e6; }
        .back-btn { width: auto; padding: 8px 15px; margin: 0; background: #444; color: white; }
        .nav-buttons { display: flex; gap: 10px; margin-bottom: 20px; }
        .nav-btn { flex: 1; padding: 12px; border-radius: 8px; border: none; background: #333; color: white; cursor: pointer; font-weight: bold; }
        .nav-btn.active { background: #00d2ff; color: #000; }
        .video-item { display: flex; align-items: center; justify-content: space-between; background: #333; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
        .video-item-info { flex: 1; margin-right: 10px; overflow: hidden; }
        .video-item-info h4 { margin: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .video-actions { display: flex; gap: 5px; }
        .action-btn { padding: 5px 10px; border-radius: 4px; border: none; color: white; cursor: pointer; font-size: 12px; }
        .edit-btn { background: #007bff; }
        .delete-btn { background: #dc3545; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; }
        .modal-content { background: #222; padding: 20px; border-radius: 10px; width: 90%; max-width: 400px; }
        .modal-header { margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; }
        #toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; }
        .toast { background: #333; color: white; padding: 12px 20px; border-radius: 8px; border-left: 5px solid #00d2ff; box-shadow: 0 4px 15px rgba(0,0,0,0.5); min-width: 200px; animation: slideIn 0.3s ease, fadeOut 0.5s 2.5s forwards; }
        .toast.success { border-left-color: #28a745; }
        .toast.error { border-left-color: #dc3545; }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeOut { to { opacity: 0; transform: translateY(10px); } }
        .section-loader { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 10px; color: #00d2ff; font-size: 24px; gap: 10px; }
        .section-loader span { font-size: 13px; color: #aaa; }
        .progress-wrapper { display: none; margin-top: 15px; background: #111; border-radius: 10px; overflow: hidden; height: 20px; position: relative; border: 1px solid #333; }
        #upload-progress-bar { width: 0%; height: 100%; background: linear-gradient(90deg, #00d2ff, #008fb3); transition: width 0.3s; }
        #progress-text { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 10px; color: #555; gap: 10px; text-align: center; }
        .empty-state i { font-size: 40px; color: #333; }
        #status { padding: 12px 18px; border-radius: 10px; font-size: 14px; margin-bottom: 20px; display: inline-flex; align-items: center; gap: 8px; background: rgba(0, 210, 255, 0.1); border: 1px solid rgba(0, 210, 255, 0.3); color: #00d2ff; font-weight: bold; }
        #status.error { background: rgba(255, 0, 0, 0.1); border: 1px solid rgba(255, 0, 0, 0.3); color: #ff4444; }
        #tag-suggestions span { background:#444; padding:4px 10px; border-radius:15px; font-size:11px; cursor:pointer; color:#ccc; margin-bottom:5px; margin-right:5px; display:inline-block; }
    </style>
</head>
<body>
    <div class="header"><h2>🛠️ T-Tube Admin</h2><button class="back-btn" onclick="window.location.href='/'">← Back to Home</button></div>
    <div id="status">Verifying Admin...</div>
    <div id="admin-controls" style="display:none;">
        <div class="nav-buttons">
            <button id="btn-upload" class="nav-btn active" onclick="showTab('upload')">Upload</button>
            <button id="btn-videos" class="nav-btn" onclick="showTab('videos')">Videos</button>
        </div>
        <div id="tab-upload">
            <div class="card">
                <h3>1. Create Category</h3>
                <input type="text" id="cat-name" placeholder="Category Name">
                <button onclick="createCategory()">Create Category</button>
            </div>
            <div class="card">
                <h3>2. Upload Video</h3>
                <select id="video-cat"><option value="">Select Category...</option></select>
                <input type="text" id="video-title" placeholder="Video Title">
                <select id="video-type"><option value="long">Long Video (16:9)</option><option value="short">Short Video (9:16)</option></select>
                <label>Tags (Max 4, comma separated):</label>
                <input type="text" id="video-tags" placeholder="e.g. funny, movie" oninput="limitTags(this)">
                <div id="tag-suggestions"></div>
                <input type="file" id="video-file" accept="video/*">
                <button onclick="uploadVideo()" id="upload-btn">Upload Video</button>
                <div class="progress-wrapper" id="upload-progress-container"><div id="upload-progress-bar"></div><div id="progress-text">0%</div></div>
            </div>
        </div>
        <div id="tab-videos" style="display:none;">
            <div class="card">
                <h3>Manage Videos</h3>
                <input type="text" id="admin-video-search" placeholder="Search by title..." style="margin-bottom:15px; border-color:#555;" oninput="filterAdminVideos()">
                <div id="video-list-container"></div>
            </div>
        </div>
    </div>
    <div id="editModal" class="modal"><div class="modal-content"><div class="modal-header"><h3>Edit Video</h3></div><input type="hidden" id="edit-video-id"><label>Title:</label><input type="text" id="edit-video-title"><label>Category:</label><select id="edit-video-cat"></select><button onclick="saveEdit()" style="background:#28a745;">Save Changes</button><button onclick="closeModal()" style="background:#444;">Cancel</button></div></div>
    <div id="confirmModal" class="modal"><div class="modal-content"><div class="modal-header"><h3>Confirmation</h3></div><p id="confirm-text"></p><div style="display:flex; gap:10px;"><button id="confirm-yes-btn" style="background:#dc3545; flex:1;">Yes, Delete</button><button onclick="closeConfirm()" style="background:#444; flex:1;">Cancel</button></div></div></div>
    <div id="toast-container"></div>
    <script>
        const initData = window.Telegram.WebApp.initData;
        const statusEl = document.getElementById('status');
        const controlsEl = document.getElementById('admin-controls');
        let categories = [], globalTags = [];

        function showToast(msg, type = 'success') {
            const container = document.getElementById('toast-container'), toast = document.createElement('div');
            toast.className = `toast ${type}`; toast.innerText = msg; container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        let confirmCallback = null;
        function showConfirm(msg, callback) { document.getElementById('confirm-text').innerText = msg; document.getElementById('confirmModal').style.display = 'flex'; confirmCallback = callback; }
        function closeConfirm() { document.getElementById('confirmModal').style.display = 'none'; }
        document.getElementById('confirm-yes-btn').onclick = () => { if(confirmCallback) confirmCallback(); closeConfirm(); };

        function markError(id) { const el = document.getElementById(id); if(el) el.classList.add('error-input'); return false; }
        function clearErrors() { document.querySelectorAll('.error-input').forEach(el => el.classList.remove('error-input')); }
        document.addEventListener('input', (e) => e.target.classList.remove('error-input'));

        if (!initData) { statusEl.innerText = "⚠️ Error: Open in Telegram"; statusEl.classList.add("error"); }
        else { statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Admin Verified'; controlsEl.style.display = "block"; loadCategories(); loadGlobalTags(); }

        async function loadCategories() {
            let res = await fetch('/api/categories'); categories = await res.json();
            let options = '<option value="">Select Category...</option>';
            categories.forEach(c => options += `<option value="${c._id}">${c.name}</option>`);
            document.getElementById('video-cat').innerHTML = options;
            document.getElementById('edit-video-cat').innerHTML = options;
        }

        async function loadGlobalTags() {
            try { let res = await fetch('/api/tags'); globalTags = await res.json(); renderTagSuggestions(); } catch(e) {}
        }

        function renderTagSuggestions() {
            const container = document.getElementById('tag-suggestions'); container.innerHTML = "";
            globalTags.slice(0, 10).forEach(tag => {
                const span = document.createElement('span'); span.innerText = "#" + tag;
                span.onclick = () => addTagToInput(tag); container.appendChild(span);
            });
        }

        function addTagToInput(tag) {
            const input = document.getElementById('video-tags');
            let tags = input.value.split(',').map(t => t.trim()).filter(t => t);
            if(tags.length < 4 && !tags.includes(tag)) { tags.push(tag); input.value = tags.join(', ') + (tags.length < 4 ? ', ' : ''); input.focus(); }
        }

        function limitTags(input) { let tags = input.value.split(',').map(t => t.trim()); if(tags.length > 4) input.value = tags.slice(0, 4).join(', '); }

        function showTab(tab) {
            document.getElementById('tab-upload').style.display = tab === 'upload' ? 'block' : 'none';
            document.getElementById('tab-videos').style.display = tab === 'videos' ? 'block' : 'none';
            document.getElementById('btn-upload').classList.toggle('active', tab === 'upload');
            document.getElementById('btn-videos').classList.toggle('active', tab === 'videos');
            if(tab === 'videos') loadVideosList();
        }

        let allAdminVideos = [];
        async function loadVideosList() {
            const container = document.getElementById('video-list-container');
            container.innerHTML = '<div class="section-loader"><i class="fas fa-circle-notch fa-spin"></i><span>Loading...</span></div>';
            try {
                let res = await fetch('/api/videos'), videos = await res.json(); 
                allAdminVideos = videos;
                renderAdminVideos(videos);
            } catch(e) { container.innerHTML = "Error loading videos"; }
        }

        function renderAdminVideos(videos) {
            const container = document.getElementById('video-list-container');
            container.innerHTML = "";
            if(videos.length === 0) { 
                container.innerHTML = '<div class="empty-state"><i class="fas fa-film"></i><p>No videos found</p></div>'; 
                return; 
            }
            videos.forEach(v => {
                const div = document.createElement('div'); div.className = 'video-item';
                div.innerHTML = `<div class="video-item-info"><h4>${v.title}</h4><small>${v.type.toUpperCase()}</small></div>
                    <div class="video-actions"><button class="action-btn edit-btn" onclick="openEditModal('${v._id}', '${v.title.replace(/'/g, "\\'")}', '${v.category_id}')">Edit</button>
                    <button class="action-btn delete-btn" onclick="handleDelete('${v._id}')">Delete</button></div>`;
                container.appendChild(div);
            });
        }

        function filterAdminVideos() {
            const query = document.getElementById('admin-video-search').value.toLowerCase();
            const filtered = allAdminVideos.filter(v => v.title.toLowerCase().includes(query));
            renderAdminVideos(filtered);
        }

        async function createCategory() {
            clearErrors(); let nameEl = document.getElementById('cat-name');
            if(!nameEl.value.trim()) { markError('cat-name'); return showToast("Name required", "error"); }
            let formData = new FormData(); formData.append("name", nameEl.value.trim());
            let res = await fetch('/api/admin/categories', { method: 'POST', headers: { 'x-telegram-init-data': initData }, body: formData });
            if(res.ok) { showToast("Created!"); loadCategories(); } else showToast("Error", "error");
        }

        async function uploadVideo() {
            clearErrors(); let fileEl = document.getElementById('video-file'), titleEl = document.getElementById('video-title'), catEl = document.getElementById('video-cat'), typeEl = document.getElementById('video-type'), tagsEl = document.getElementById('video-tags'), btn = document.getElementById('upload-btn');
            if(!fileEl.files[0] || !titleEl.value.trim() || !catEl.value) { markError('video-file'); markError('video-title'); markError('video-cat'); return showToast("Fill all fields", "error"); }
            let formData = new FormData(); formData.append("video_file", fileEl.files[0]); formData.append("title", titleEl.value.trim()); formData.append("category_id", catEl.value); formData.append("type", typeEl.value); formData.append("tags", tagsEl.value.trim());
            btn.disabled = true; btn.style.background = "#555";
            let pc = document.getElementById('upload-progress-container'), pb = document.getElementById('upload-progress-bar'), pt = document.getElementById('progress-text');
            pc.style.display = "block"; pb.style.width = "0%"; pt.innerText = "0%";
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (e) => { if(e.lengthComputable) { let p = Math.round((e.loaded/e.total)*100); pb.style.width=p+"%"; pt.innerText=p+"%"; btn.innerText=`Uploading... ${p}%`; if(p==100) btn.innerText="Processing..."; } };
            xhr.onload = () => { btn.disabled = false; btn.style.background = "#00d2ff"; btn.innerText = "Upload Video"; if(xhr.status==200) { showToast("Success!"); titleEl.value=""; fileEl.value=""; pc.style.display="none"; loadGlobalTags(); } else showToast("Failed", "error"); };
            xhr.open("POST", "/api/admin/upload", true); xhr.setRequestHeader('x-telegram-init-data', initData); xhr.send(formData);
        }

        function openEditModal(id, title, catId) { document.getElementById('edit-video-id').value = id; document.getElementById('edit-video-title').value = title; document.getElementById('edit-video-cat').value = catId; document.getElementById('editModal').style.display = 'flex'; }
        function closeModal() { document.getElementById('editModal').style.display = 'none'; }
        async function saveEdit() {
            clearErrors(); let id = document.getElementById('edit-video-id').value, titleEl = document.getElementById('edit-video-title'), catEl = document.getElementById('edit-video-cat');
            if(!titleEl.value.trim() || !catEl.value) return showToast("Fields required", "error");
            let formData = new FormData(); formData.append("title", titleEl.value.trim()); formData.append("category_id", catEl.value);
            let res = await fetch(`/api/admin/video/${id}/update`, { method: 'POST', headers: { 'x-telegram-init-data': initData }, body: formData });
            if(res.ok) { showToast("Updated!"); closeModal(); loadVideosList(); } else showToast("Error", "error");
        }

        function handleDelete(id) { showConfirm("Delete this video?", async () => { let res = await fetch(`/api/admin/video/${id}`, { method: 'DELETE', headers: { 'x-telegram-init-data': initData } }); if(res.ok) { showToast("Deleted!"); loadVideosList(); } else showToast("Error", "error"); }); }
    </script>
</body>
</html>
"""

@app.get("/admin", response_class=HTMLResponse)
async def get_admin_dashboard(): return ADMIN_HTML

@app.get("/api/videos")
async def get_videos(type: Optional[str] = None, category_id: Optional[str] = None):
    query = {}
    if type: query["type"] = type
    if category_id: query["category_id"] = category_id
    cursor = db.videos.find(query).sort("created_at", -1)
    videos = []
    async for doc in cursor: 
        doc["_id"] = str(doc["_id"])
        # Ensure pixeldrain_id is exposed for direct CF streaming
        doc["pixeldrain_id"] = doc.get("pixeldrain_id")
        videos.append(doc)
    return videos

@app.get("/api/videos/search")
async def search_videos(q: str):
    query = {"title": {"$regex": q, "$options": "i"}}
    cursor = db.videos.find(query).sort("created_at", -1)
    videos = []
    async for doc in cursor: 
        doc["_id"] = str(doc["_id"])
        doc["pixeldrain_id"] = doc.get("pixeldrain_id")
        videos.append(doc)
    return videos

@app.get("/api/categories")
async def get_categories():
    cursor = db.categories.find()
    categories = []
    async for doc in cursor: doc["_id"] = str(doc["_id"]); categories.append(doc)
    return categories

@app.get("/api/tags")
async def get_all_tags():
    cursor = db.tags.find().sort("count", -1)
    tags = []
    async for doc in cursor: tags.append(doc["name"])
    return tags

@app.get("/api/stream")
async def stream_media(file_id: str, is_image: bool = False):
    async def media_generator():
        try:
            async for chunk in tg_client.stream_media(file_id): yield chunk
        except Exception as e: print(f"Stream Error: {e}")
    if is_image: return StreamingResponse(media_generator(), media_type="image/jpeg")
    return StreamingResponse(media_generator(), media_type="video/mp4")

# --- Recommendation Logic ---
@app.get("/api/videos/recommended")
async def get_recommended_videos(user_id: str = Depends(get_user_id), current_video_id: Optional[str] = None, type: Optional[str] = None):
    # 1. Fetch all videos (with optional type filter)
    query = {}
    if type: query["type"] = type
    
    all_videos_cursor = db.videos.find(query).sort("created_at", -1)
    all_v = []
    async for v in all_videos_cursor:
        v["_id"] = str(v["_id"])
        # Ensure pixeldrain_id is exposed
        v["pixeldrain_id"] = v.get("pixeldrain_id")
        if v["_id"] == current_video_id: continue
        all_v.append(v)

    if user_id == "guest" or not all_v:
        import random
        random.shuffle(all_v)
        return all_v[:40]

    # 2. Get User Profile
    profile = await db.user_profiles.find_one({"user_id": user_id}) or {"categories": {}, "tags": {}}
    user_cats = profile.get("categories", {})
    user_tags = profile.get("tags", {})
    
    # Identify top interests
    top_cats = sorted(user_cats.keys(), key=lambda k: user_cats[k], reverse=True)[:3]
    top_tags = sorted(user_tags.keys(), key=lambda k: user_tags[k], reverse=True)[:5]

    # 3. Create Buckets
    personalized = []
    fresh = []
    discovery = []
    trending = []
    
    now = datetime.utcnow()
    seen_ids = set()

    # Bucket A: Personalized (Matches interests)
    for v in all_v:
        is_p = v.get("category_id") in top_cats or any(t in top_tags for t in v.get("tags", []))
        if is_p:
            personalized.append(v)
            seen_ids.add(v["_id"])

    # Bucket B: Fresh (New uploads, last 7 days, not seen in P)
    for v in all_v:
        if v["_id"] in seen_ids: continue
        if now - v["created_at"] < timedelta(days=7):
            fresh.append(v)
            seen_ids.add(v["_id"])

    # Bucket C: Trending (Popular, not seen in P/F)
    remaining = [v for v in all_v if v["_id"] not in seen_ids]
    remaining.sort(key=lambda x: x.get("view_count", 0), reverse=True)
    trending = remaining[:20]
    for v in trending: seen_ids.add(v["_id"])

    # Bucket D: Discovery (Random mix of rest)
    discovery = [v for v in all_v if v["_id"] not in seen_ids]
    import random
    random.shuffle(discovery)

    # 4. Pattern Mixing (Pattern: 2P, 1F, 1P, 1D, 1T)
    final_feed = []
    p_ptr, f_ptr, d_ptr, t_ptr = 0, 0, 0, 0
    
    # Fill empty buckets with Discovery to ensure pattern is never broken
    if not personalized: personalized = discovery[:20]
    if not fresh: fresh = discovery[20:30]
    if not trending: trending = discovery[30:40]

    def pick(bucket, ptr):
        if ptr < len(bucket): return bucket[ptr], ptr + 1
        # If bucket is exhausted, pick a random one from all_v not in final_feed
        import random
        existing_ids = {v["_id"] for v in final_feed}
        pool = [v for v in all_v if v["_id"] not in existing_ids]
        if pool: return random.choice(pool), ptr
        return None, ptr

    for _ in range(15): # 15 cycles = 90 videos max
        # 2 Personalized
        for _ in range(2):
            vid, p_ptr = pick(personalized, p_ptr)
            if vid and vid["_id"] not in {x["_id"] for x in final_feed}: final_feed.append(vid)
        
        # 1 Fresh
        vid, f_ptr = pick(fresh, f_ptr)
        if vid and vid["_id"] not in {x["_id"] for x in final_feed}: final_feed.append(vid)
        
        # 1 Personalized
        vid, p_ptr = pick(personalized, p_ptr)
        if vid and vid["_id"] not in {x["_id"] for x in final_feed}: final_feed.append(vid)
        
        # 1 Discovery
        vid, d_ptr = pick(discovery, d_ptr)
        if vid and vid["_id"] not in {x["_id"] for x in final_feed}: final_feed.append(vid)
        
        # 1 Trending
        vid, t_ptr = pick(trending, t_ptr)
        if vid and vid["_id"] not in {x["_id"] for x in final_feed}: final_feed.append(vid)

    return final_feed[:60]

@app.post("/api/views/{video_id}")
async def increment_view(video_id: str, user_id: str = Depends(get_user_id)):
    video = await db.videos.find_one({"_id": ObjectId(video_id)})
    if not video: return {"status": "error"}
    await db.videos.update_one({"_id": ObjectId(video_id)}, {"$inc": {"view_count": 1}, "$set": {"last_active": datetime.utcnow()}})
    if user_id != "guest":
        update_query = {"$inc": {}}
        if video.get("category_id"): update_query["$inc"][f"categories.{video['category_id']}"] = 1
        for tag in video.get("tags", []): update_query["$inc"][f"tags.{tag}"] = 1
        if update_query["$inc"]: await db.user_profiles.update_one({"user_id": user_id}, update_query, upsert=True)
    return {"status": "success"}

@app.post("/api/admin/video/{video_id}/update")
async def update_video(video_id: str, title: str = Form(...), category_id: str = Form(...), admin_id: str = Depends(get_admin)):
    await db.videos.update_one({"_id": ObjectId(video_id)}, {"$set": {"title": title, "category_id": category_id}})
    return {"status": "success"}

@app.delete("/api/admin/video/{video_id}")
async def delete_video(video_id: str, admin_id: str = Depends(get_admin)):
    await db.videos.delete_one({"_id": ObjectId(video_id)})
    return {"status": "success"}

@app.post("/api/admin/categories")
async def create_category(name: str = Form(...), admin_id: str = Depends(get_admin)):
    await db.categories.insert_one({"name": name})
    return {"status": "success"}

@app.post("/api/admin/upload")
async def upload_video(
    request: Request,
    title: str = Form(...),
    video_file: UploadFile = File(...),
    tags: str = Form(""),
    admin_id: str = Depends(get_admin)
):
    form_data = await request.form()
    video_type = form_data.get("type", "long").lower()
    category_id = form_data.get("category_id", "")
    raw_tags = [t.strip().lower() for t in tags.split(",") if t.strip()]
    final_tags = raw_tags[:4]
    file_ext = video_file.filename.split('.')[-1] if '.' in video_file.filename else 'mp4'
    temp_video = f"temp_{uuid.uuid4().hex}.{file_ext}"
    async with aiofiles.open(temp_video, 'wb') as out_file:
        content = await video_file.read()
        await out_file.write(content)
    cap = cv2.VideoCapture(temp_video)
    success, image = cap.read()
    thumb_path = f"thumb_{video_file.filename}.jpg"
    if success: cv2.imwrite(thumb_path, image)
    cap.release()
    try:
        video_msg: Message = await tg_client.send_video(chat_id=int(CHAT_ID), video=temp_video, thumb=thumb_path if success else None, caption=f"Backup: {title}")
    except Exception as e:
        if os.path.exists(temp_video): os.remove(temp_video)
        if os.path.exists(thumb_path): os.remove(thumb_path)
        raise HTTPException(status_code=500, detail=f"Telegram error: {str(e)}")
    file_id = video_msg.video.file_id
    thumbnail_id = video_msg.video.thumbs[0].file_id if video_msg.video.thumbs else None
    pixeldrain_id = await upload_to_pixeldrain(temp_video)
    video_doc = {"title": title, "type": video_type, "category_id": category_id, "tags": final_tags, "file_id": file_id, "pixeldrain_id": pixeldrain_id, "thumbnail_id": thumbnail_id, "message_id": video_msg.id, "view_count": 0, "last_active": datetime.utcnow(), "created_at": datetime.utcnow()}
    await db.videos.insert_one(video_doc)
    for tag in final_tags: await db.tags.update_one({"name": tag}, {"$inc": {"count": 1}}, upsert=True)
    if os.path.exists(temp_video): os.remove(temp_video)
    if os.path.exists(thumb_path): os.remove(thumb_path)
    return {"status": "success"}

@app.get("/api/stream/{video_id}")
async def stream_video(video_id: str, request: Request):
    try: video = await db.videos.find_one({"_id": ObjectId(video_id)})
    except: raise HTTPException(status_code=400, detail="Invalid ID")
    if not video: raise HTTPException(status_code=404, detail="Not found")
    
    pixeldrain_id = video.get("pixeldrain_id")
    
    async def telegram_stream_generator(v_doc):
        fresh_file_id = await get_working_file_id(v_doc)
        if not fresh_file_id: return
        try:
            async for chunk in tg_client.stream_media(fresh_file_id):
                yield chunk
        except Exception as e: print(f"[Telegram Stream] Error: {e}")

    if pixeldrain_id:
        # User ko Cloudflare Worker par Redirect kar do (Superfast Speed)
        # Worker URL ke peeche File ID attach hogi
        return RedirectResponse(url=f"{CF_WORKER_URL}/{pixeldrain_id}")
    
    # Direct Telegram Fallback (Only if Pixeldrain ID is missing)
    return StreamingResponse(telegram_stream_generator(video), media_type="video/mp4")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
