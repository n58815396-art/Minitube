import os
import asyncio
import hmac
import hashlib
import json
import random
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import parse_qs

from fastapi import FastAPI, Request, Depends, Header
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
BOT_TOKEN = os.getenv("BOT_TOKEN")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

mongo_client = AsyncIOMotorClient(MONGO_URI)
db = mongo_client["mini_clips"]

def parse_id(vid: str):
    try: return ObjectId(vid)
    except: return vid

# --- Authentication for Personalized Feed ---
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

# --- Public APIs (Read Only) ---

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

@app.get("/api/videos/search")
async def search_videos(q: str):
    query = {"title": {"$regex": q, "$options": "i"}}
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
    async for doc in cursor: doc["_id"] = str(doc["_id"]); categories.append(doc)
    return categories

@app.get("/api/tags")
async def get_all_tags():
    cursor = db.tags.find().sort("count", -1)
    tags = []
    async for doc in cursor: tags.append(doc["name"])
    return tags

@app.get("/api/videos/recommended")
async def get_recommended_videos(user_id: str = Depends(get_user_id), current_video_id: Optional[str] = None, type: Optional[str] = None):
    match_query = {}
    if type: match_query["type"] = type
    if current_video_id: match_query["_id"] = {"$ne": parse_id(current_video_id)}
    
    # If guest, just return random sample
    if user_id == "guest":
        pipeline = [{"$match": match_query}, {"$sample": {"size": 60}}]
        cursor = db.videos.aggregate(pipeline)
        videos = []
        async for v in cursor:
            v["_id"] = str(v["_id"])
            videos.append(v)
        return videos

    # Simple personalized recommendation logic
    profile = await db.user_profiles.find_one({"user_id": user_id}) or {"categories": {}, "tags": {}}
    user_cats = profile.get("categories", {})
    top_cats = sorted(user_cats.keys(), key=lambda k: user_cats[k], reverse=True)[:3]
    
    # Use aggregation to get mixed results
    pipeline = [
        {"$match": match_query},
        {"$addFields": {
            "is_preferred": {"$cond": [{"$in": ["$category_id", top_cats]}, 1, 0]}
        }},
        {"$sort": {"is_preferred": -1, "created_at": -1}},
        {"$limit": 100},
        {"$sample": {"size": 60}}
    ]
    
    cursor = db.videos.aggregate(pipeline)
    videos = []
    async for v in cursor:
        v["_id"] = str(v["_id"])
        videos.append(v)
    return videos

@app.post("/api/views/{video_id}")
async def increment_view(video_id: str, user_id: str = Depends(get_user_id)):
    video = await db.videos.find_one({"_id": parse_id(video_id)})
    if not video: return {"status": "error"}
    await db.videos.update_one({"_id": parse_id(video_id)}, {"$inc": {"view_count": 1}, "$set": {"last_active": datetime.utcnow()}})
    if user_id != "guest":
        update_query = {"$inc": {}}
        if video.get("category_id"): update_query["$inc"][f"categories.{video['category_id']}"] = 1
        if update_query["$inc"]: await db.user_profiles.update_one({"user_id": user_id}, update_query, upsert=True)
    return {"status": "success"}

@app.get("/api/video/{video_id}")
async def get_single_video_json(video_id: str):
    video = await db.videos.find_one({"_id": parse_id(video_id)})
    if not video: return {"status": "error"}
    video["_id"] = str(video["_id"])
    return video

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
