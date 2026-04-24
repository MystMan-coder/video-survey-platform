import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from .database import engine, init_db
from .config import settings
from . import models
from .routers import surveys, submissions

app = FastAPI(title="Video Survey API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# create the media dir if it doesn't exist yet, then mount it as a static route
os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.MEDIA_ROOT), name="media")

app.include_router(surveys.router)
app.include_router(submissions.router)

@app.on_event("startup")
async def startup_event():
    init_db()
    print("Database tables created/verified.")

@app.get("/health")
async def health_check():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"
    return {"status": "healthy", "database": db_status}