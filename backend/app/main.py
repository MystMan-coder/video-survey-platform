from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from .database import engine, init_db
from .config import settings
from . import models
from .routers import surveys, submissions, export

app = FastAPI(title="Video Survey API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(surveys.router)
app.include_router(submissions.router)
app.include_router(export.router)


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