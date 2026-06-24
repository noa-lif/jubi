"""
FastAPI application entry point.

Start the dev server with:
    cd server
    uvicorn app.main:app --reload

Interactive docs:
    http://localhost:8000/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, categories, transactions, uploads
from app.db.init_db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before the server begins accepting requests."""
    init_db()  # Create tables + seed system categories
    yield
    # (add teardown logic here if needed in future)


app = FastAPI(
    title="Jubi API",
    version="0.1.0",
    description="Jubi — personal expense tracker, FastAPI backend",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow the Vite dev server (port 5173) during development.
# Tighten origins for production deployment.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://jubiapp.vercel.app", "https://jubijubi.com", "https://www.jubijubi.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(uploads.router)


@app.get("/health", tags=["meta"])
def health_check() -> dict:
    return {"status": "ok"}
