"""Sales Pipeline Portal - Accounts, Pipeline & Retention Risk Dashboard."""
import logging
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from server.routes import accounts, opportunities, churn, features, demo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sales Pipeline Portal", version="1.0.0")

# Register API routes
app.include_router(accounts.router)
app.include_router(opportunities.router)
app.include_router(churn.router)
app.include_router(features.router)
app.include_router(demo.router)

# Serve React frontend
client_dir = Path(__file__).parent / "client" / "out"
if client_dir.exists():
    app.mount("/assets", StaticFiles(directory=client_dir / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve React SPA for all non-API routes."""
        file_path = client_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(client_dir / "index.html")
else:
    @app.get("/")
    def root():
        return {"message": "Sales Pipeline Portal API", "docs": "/docs"}

logger.info("Sales Pipeline Portal started")
