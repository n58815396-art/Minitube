import os
import asyncio
import hmac
import hashlib
import json
from datetime import datetime
from typing import Optional, List
from urllib.parse import parse_qs

import cv2
import aiofiles
from fastapi import FastAPI, HTTPException, Request, Depends, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
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

# --- Lifespan ---
@app.on_event("startup")
async def startup():
    await tg_client.start()

@app.on_event("shutdown")
async def shutdown():
    await tg_client.stop()

# --- Helpers ---
async def get_admin(x_telegram_init_data: Optional[str] = Header(None)):
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    # In a real app, verify the signature with BOT_TOKEN. 
    # For this prototype, we'll parse the data and check user ID.
    try:
        data = parse_qs(x_telegram_init_data)
        user = json.loads(data.get("user", ["{}"])[0])
        user_id = str(user.get("id"))
        if user_id != ADMIN_ID:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user_id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Init Data")

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

@app.get("/api/categories")
async def get_categories():
    cursor = db.categories.find()
    categories = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        categories.append(doc)
    return categories

@app.get("/api/stream/{file_id}")
async def stream_video(file_id: str):
    async def generator():
        async for chunk in tg_client.stream_media(file_id):
            yield chunk
    return StreamingResponse(generator(), media_type="video/mp4")

@app.post("/api/views/{video_id}")
async def increment_view(video_id: str):
    from bson import ObjectId
    await db.videos.update_one({"_id": ObjectId(video_id)}, {"$inc": {"view_count": 1}})
    return {"status": "success"}

# --- Admin Routes ---

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
    # Manually get other form fields to avoid issues with order or type
    form_data = await request.form()
    video_type = form_data.get("type", "long").lower()
    category_id = form_data.get("category_id", "")

    print(f"Upload Request: Title={title}, Type={video_type}, Category={category_id}")
    
    # 1. Save video temporarily to generate thumbnail
    temp_video = f"temp_{video_file.filename}"
    async with aiofiles.open(temp_video, 'wb') as out_file:
        content = await video_file.read()
        await out_file.write(content)

    # 2. Generate Thumbnail using OpenCV (fast)
    cap = cv2.VideoCapture(temp_video)
    success, image = cap.read()
    thumb_path = f"thumb_{video_file.filename}.jpg"
    if success:
        cv2.imwrite(thumb_path, image)
    cap.release()

    # 3. Upload to Telegram
    try:
        print(f"Uploading to Telegram... Chat ID: {CHAT_ID}")
        video_msg: Message = await tg_client.send_video(
            chat_id=int(CHAT_ID),
            video=temp_video,
            thumb=thumb_path if success else None,
            caption=title
        )
    except Exception as e:
        print(f"Telegram Upload Error: {str(e)}")
        # Cleanup before raising
        if os.path.exists(temp_video): os.remove(temp_video)
        if os.path.exists(thumb_path): os.remove(thumb_path)
        raise HTTPException(status_code=500, detail=f"Telegram upload failed: {str(e)}")
    
    file_id = video_msg.video.file_id
    thumbnail_id = video_msg.video.thumbs[0].file_id if video_msg.video.thumbs else None

    # 4. Save to MongoDB
    video_doc = {
        "title": title,
        "type": video_type,
        "category_id": category_id,
        "file_id": file_id,
        "thumbnail_id": thumbnail_id,
        "view_count": 0,
        "created_at": datetime.utcnow()
    }
    await db.videos.insert_one(video_doc)

    # 5. Cleanup
    os.remove(temp_video)
    if os.path.exists(thumb_path): os.remove(thumb_path)

    return {"status": "success"}

# --- Serve Frontend ---
if not os.path.exists("static"):
    os.makedirs("static")
    # Create a simple placeholder if it's missing
    with open("static/index.html", "w") as f:
        f.write("<h1>Minitube Static Folder Missing</h1>")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
