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
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pyrogram import Client
from pyrogram.types import Message
from dotenv import load_dotenv

load_dotenv()

# --- Config ---
API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
BOT_TOKEN = os.getenv("BOT_TOKEN")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
ADMIN_ID = os.getenv("ADMIN_ID") # Specified Admin Telegram ID
CHAT_ID = os.getenv("CHAT_ID")   # Telegram Chat ID to store videos

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Database & Clients ---
mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client["mini_clips"]
tg_client = Client("mini_clips_session", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

# --- Pixeldrain Upload Helper ---
async def upload_to_pixeldrain(file_path: str):
    try:
        data = aiohttp.FormData()
        data.add_field('file', open(file_path, 'rb'), filename=os.path.basename(file_path))
        
        # API Key ko authentication ke liye set kiya
        auth = aiohttp.BasicAuth('', PIXELDRAIN_API_KEY) if PIXELDRAIN_API_KEY else None
        
        async with aiohttp.ClientSession() as session:
            # auth=auth add kar diya request me
            async with session.post("https://pixeldrain.com/api/file", data=data, auth=auth) as resp:
                result = await resp.json()
                if result.get("success"):
                    return result.get("id")
                else:
                    print(f"Pixeldrain API Error: {result}")
    except Exception as e:
        print(f"Pixeldrain Upload Error: {e}")
    return None


# --- Auto-Heal & Smart Ping Background Worker ---
async def background_healer():
    while True:
        try:
            print("[Auto-Healer] Checking for inactive videos...")
            # Check videos inactive for more than 45 days
            threshold_date = datetime.utcnow() - timedelta(days=45)
            cursor = db.videos.find({"last_active": {"$lt": threshold_date}})
            
            async for video in cursor:
                pixeldrain_id = video.get("pixeldrain_id")
                if not pixeldrain_id: continue
                
                url = f"https://pixeldrain.com/api/file/{pixeldrain_id}"
                async with aiohttp.ClientSession() as session:
                    # Check if file still exists on Pixeldrain
                    async with session.head(url) as resp:
                        if resp.status == 404:
                            # 🚨 THE MASTERPLAN FAILSAFE: File deleted, Time to Heal!
                            print(f"[Auto-Healer] Video {video['title']} deleted from Pixeldrain. Healing from Telegram...")
                            
                            # 1. Download from Telegram Backup
                            temp_path = await tg_client.download_media(video["file_id"])
                            
                            # 2. Re-upload to Pixeldrain
                            new_pd_id = await upload_to_pixeldrain(temp_path)
                            
                            if new_pd_id:
                                # 3. Update Database
                                await db.videos.update_one(
                                    {"_id": video["_id"]},
                                    {"$set": {"pixeldrain_id": new_pd_id, "last_active": datetime.utcnow()}}
                                )
                                print(f"[Auto-Healer] Healing complete. New ID: {new_pd_id}")
                            
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                                
                        else:
                            # 🟢 SMART PING: File exists, just ping 1 byte to reset the 60-day timer
                            async with session.get(url, headers={"Range": "bytes=0-1"}) as ping_resp:
                                print(f"[Auto-Healer] Pinged {video['title']} to reset 60-day timer.")
                            
                            # Update active time in DB
                            await db.videos.update_one(
                                {"_id": video["_id"]},
                                {"$set": {"last_active": datetime.utcnow()}}
                            )
                            
        except Exception as e:
            print(f"[Auto-Healer] Routine Error: {e}")
        
        # Run this check once every 24 hours (86400 seconds)
        await asyncio.sleep(86400)

# --- Lifespan ---
@app.on_event("startup")
async def startup():
    await tg_client.start()
    # Start the Sanjeevani Background Task
    asyncio.create_task(background_healer())

@app.on_event("shutdown")
async def shutdown():
    await tg_client.stop()

# --- Helpers ---
async def get_admin(x_telegram_init_data: Optional[str] = Header(None)):
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        parsed_data = parse_qs(x_telegram_init_data)
        data_to_check = {k: v[0] for k, v in parsed_data.items() if k != 'hash'}
        received_hash = parsed_data.get('hash', [None])[0]
        data_list = sorted([f"{k}={v}" for k, v in data_to_check.items()])
        data_check_string = "\n".join(data_list)
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        if calculated_hash != received_hash:
             raise HTTPException(status_code=403, detail="Invalid Signature")

        user = json.loads(data_to_check.get("user", "{}"))
        user_id = str(user.get("id"))
        if user_id != ADMIN_ID:
            raise HTTPException(status_code=403, detail="Forbidden: Not Admin")
        return user_id
    except Exception as e:
        print(f"Auth Error: {e}")
        raise HTTPException(status_code=401, detail="Authentication Failed")

# --- Routes ---

@app.get("/api/videos")
async def get_videos(type: Optional[str] = None, category_id: Optional[str] = None):
    query = {}
    if type: query["type"] = type
    if category_id: query["category_id"] = category_id
    
    cursor = db.videos.find(query).sort("created_at", -1)
    videos = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        videos.append(doc)
    return videos

@app.get("/api/videos/trending")
async def get_trending_videos():
    cursor = db.videos.find().sort("view_count", -1).limit(20)
    videos = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        videos.append(doc)
    return videos

@app.get("/api/videos/search")
async def search_videos(q: str):
    query = {"title": {"$regex": q, "$options": "i"}}
    cursor = db.videos.find(query).sort("created_at", -1)
    videos = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        videos.append(doc)
    return videos

@app.get("/api/videos/category/{category_id}")
async def get_category_videos(category_id: str):
    cursor = db.videos.find({"category_id": category_id}).sort("created_at", -1)
    videos = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        videos.append(doc)
    return videos

@app.get("/api/categories")
async def get_categories():
    cursor = db.categories.find()
    categories = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        categories.append(doc)
    return categories

@app.get("/api/stream")
async def stream_media(file_id: str, is_image: bool = False):
    # This remains ONLY for THUMBNAILS (Very fast and small, no Pixeldrain needed)
    async def media_generator():
        try:
            async for chunk in tg_client.stream_media(file_id):
                yield chunk
        except Exception as e:
            print(f"Stream Error: {e}")

    if is_image:
        return StreamingResponse(media_generator(), media_type="image/jpeg")
    return StreamingResponse(media_generator(), media_type="video/mp4")

@app.post("/api/views/{video_id}")
async def increment_view(video_id: str):
    # Update view count AND update last_active to reset the timer naturally!
    await db.videos.update_one(
        {"_id": ObjectId(video_id)}, 
        {"$inc": {"view_count": 1}, "$set": {"last_active": datetime.utcnow()}}
    )
    return {"status": "success"}

# --- Admin Routes ---

@app.delete("/api/admin/video/{video_id}")
async def delete_video(video_id: str, admin_id: str = Depends(get_admin)):
    await db.videos.delete_one({"_id": ObjectId(video_id)})
    return {"status": "success"}

@app.patch("/api/admin/video/{video_id}")
async def update_video_info(
    video_id: str, 
    title: str = Form(...), 
    category_id: str = Form(...),
    admin_id: str = Depends(get_admin)
):
    await db.videos.update_one(
        {"_id": ObjectId(video_id)}, 
        {"$set": {"title": title, "category_id": category_id}}
    )
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
    admin_id: str = Depends(get_admin)
):
    form_data = await request.form()
    video_type = form_data.get("type", "long").lower()
    category_id = form_data.get("category_id", "")
    
    file_ext = video_file.filename.split('.')[-1] if '.' in video_file.filename else 'mp4'
    temp_video = f"temp_{uuid.uuid4().hex}.{file_ext}"
    
    async with aiofiles.open(temp_video, 'wb') as out_file:
        content = await video_file.read()
        await out_file.write(content)

    # 1. Generate Thumbnail
    cap = cv2.VideoCapture(temp_video)
    success, image = cap.read()
    thumb_path = f"thumb_{video_file.filename}.jpg"
    if success:
        cv2.imwrite(thumb_path, image)
    cap.release()

    # 2. Upload to Telegram (COLD STORAGE BACKUP)
    print("Uploading to Telegram for Permanent Backup...")
    try:
        video_msg: Message = await tg_client.send_video(
            chat_id=int(CHAT_ID),
            video=temp_video,
            thumb=thumb_path if success else None,
            caption=f"Backup: {title}"
        )
    except Exception as e:
        os.remove(temp_video)
        if os.path.exists(thumb_path): os.remove(thumb_path)
        raise HTTPException(status_code=500, detail=f"Telegram upload failed: {str(e)}")
        
    file_id = video_msg.video.file_id
    thumbnail_id = video_msg.video.thumbs[0].file_id if video_msg.video.thumbs else None

    # 3. Upload to Pixeldrain (HOT STREAMING)
    print("Uploading to Pixeldrain for Fast Streaming...")
    pixeldrain_id = await upload_to_pixeldrain(temp_video)
    
    if not pixeldrain_id:
        print("Pixeldrain upload failed, but Telegram backup is safe.")

    # 4. Save to MongoDB
    video_doc = {
        "title": title,
        "type": video_type,
        "category_id": category_id,
        "file_id": file_id,                  # Backup ID
        "pixeldrain_id": pixeldrain_id,      # Streaming ID
        "thumbnail_id": thumbnail_id,
        "view_count": 0,
        "last_active": datetime.utcnow(),    # For Auto-Heal tracking
        "created_at": datetime.utcnow()
    }
    await db.videos.insert_one(video_doc)

    # 5. Cleanup
    os.remove(temp_video)
    if os.path.exists(thumb_path): os.remove(thumb_path)

    return {"status": "success"}

# --- Zero-Cost Fast Streaming Route ---
@app.get("/api/stream/{video_id}")
async def stream_video(video_id: str):
    try:
        video = await db.videos.find_one({"_id": ObjectId(video_id)})
    except:
        raise HTTPException(status_code=400, detail="Invalid Video ID")
        
    if not video or not video.get("pixeldrain_id"):
        # Fallback to Telegram if Pixeldrain ID is missing for older videos
        if video and video.get("file_id"):
            async def fallback_generator():
                async for chunk in tg_client.stream_media(video["file_id"]):
                    yield chunk
            return StreamingResponse(fallback_generator(), media_type="video/mp4")
        raise HTTPException(status_code=404, detail="Video not found")
    
    # MASTERSTROKE: Redirect directly to Pixeldrain!
    # Aapka server ka bandwidth 0 lagega aur player me Pixeldrain ki link play hogi.
    pd_url = f"https://pixeldrain.com/api/file/{video['pixeldrain_id']}"
    return RedirectResponse(url=pd_url, status_code=302)

# --- Serve Frontend ---
if not os.path.exists("static"):
    os.makedirs("static")
    with open("static/index.html", "w") as f:
        f.write("<h1>TeleTube Static Folder Missing</h1>")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
